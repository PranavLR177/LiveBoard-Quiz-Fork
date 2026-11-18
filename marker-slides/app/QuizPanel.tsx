'use client';
import { useEffect, useState } from 'react';
import { classesBackend, type QuizQuestion, type QuizResult, type TeacherQuiz } from './classesApi';

/* Pop quizzes for one class. A teacher writes a few questions with their answers and releases them: every student in
   the class gets them pushed to LiveBoard at once, at the top of their recall (required ones stay there until done).
   Students answer from memory, typed or out loud, then mark each Got it or Again against the teacher's answer, and
   send one result. Here the teacher sees who has done it, the scores and what each student said.
   Self-graded, like all recall: it's a check-in on what stuck, not a secure test. */

const blank = (): QuizQuestion => ({ q: '', a: '' });
const tomorrow = () => { const d = new Date(Date.now() + 864e5); d.setHours(17, 0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const dueText = (iso: string | null) => { if (!iso) return 'no due time'; const d = new Date(iso), h = Math.round((d.getTime() - Date.now()) / 36e5); return h < 0 ? 'past due' : h < 24 ? `due in ${Math.max(1, h)}h` : `due ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`; };

export default function QuizPanel({ classId, students }: { classId: string; students: number }) {
  const api = classesBackend();
  const [list, setList] = useState<TeacherQuiz[] | null>(null);
  const [open, setOpen] = useState('');
  const [results, setResults] = useState<QuizResult[] | null>(null);
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState('');
  const [qs, setQs] = useState<QuizQuestion[]>([blank(), blank()]);
  const [required, setRequired] = useState(true);
  const [due, setDue] = useState(tomorrow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api?.quizzes(classId).then(setList).catch(e => setError(e.message));
  useEffect(() => { setList(null); setOpen(''); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [classId]);
  useEffect(() => { setResults(null); if (api && open) api.quizResults(open).then(setResults).catch(e => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const ready = qs.filter(x => x.q.trim());
  async function release(e: React.FormEvent) {
    e.preventDefault(); if (!api || !ready.length) return;
    setBusy(true); setError('');
    try {
      await api.releaseQuiz(classId, title.trim() || 'Pop quiz', ready.map(x => ({ q: x.q.trim(), a: x.a.trim() })), required, due ? new Date(due).toISOString() : null);
      setMaking(false); setTitle(''); setQs([blank(), blank()]); setDue(tomorrow()); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not release the quiz.'); }
    finally { setBusy(false); }
  }
  async function close(q: TeacherQuiz, remove: boolean) {
    if (!api) return;
    try { await api.closeQuiz(q.id, remove); if (remove && open === q.id) setOpen(''); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not change the quiz.'); }
  }

  return <section className="quiz-panel" aria-label="Pop quizzes">
    <div className="quiz-top"><p className="quiet">Release a few questions to everyone in the class. They show up at the top of each student's recall right away.</p>
      <button className="primary" onClick={() => setMaking(true)} disabled={!students} title={students ? '' : 'No students in this class yet'}>New pop quiz</button></div>
    {error && <p role="alert" className="class-error">{error} <button onClick={() => setError('')}>Dismiss</button></p>}
    {list === null ? <p className="quiet">Loading quizzes…</p> : !list.length ? <p className="class-none">No pop quizzes yet.</p> :
      <ul className="quiz-list">{list.map(q => <li key={q.id} className={'quiz-card' + (q.closed ? ' closed' : '') + (open === q.id ? ' open' : '')}>
        <button className="quiz-row" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? '' : q.id)}>
          <span className="quiz-name"><b>{q.title}</b><small>{q.questions} question{q.questions === 1 ? '' : 's'} · {q.required ? 'required' : 'optional'} · {q.closed ? 'closed' : dueText(q.dueAt)}</small></span>
          <span className="quiz-done"><span className="roster-bar" aria-hidden="true"><u style={{ width: (q.students ? Math.round(100 * q.done / q.students) : 0) + '%' }} /></span><small>{q.done} of {q.students} done</small></span>
          <span className="quiz-avg">{q.avgPct == null ? '–' : q.avgPct + '%'}<small>average</small></span>
        </button>
        {open === q.id && <div className="quiz-results">
          {results === null ? <p className="quiet">Loading…</p> : <table className="roster"><thead><tr><th>Student</th><th>Score</th><th>What they said</th></tr></thead>
            <tbody>{results.map(r => <tr key={r.userId}><td><span className="roster-name"><i>{r.name.slice(0, 1).toUpperCase()}</i>{r.name}</span></td>
              <td>{r.done ? <b>{r.score} / {r.total}</b> : <span className="quiet">not yet</span>}</td>
              <td>{r.done ? <div className="quiz-said">{r.answers.map((a, i) => <span key={i} data-got={a.got}>{i + 1}. {a.said || '(nothing typed)'}</span>)}</div> : null}</td></tr>)}</tbody></table>}
          <div className="quiz-acts">{!q.closed && <button onClick={() => close(q, false)}>Close it</button>}<button className="class-delete" onClick={() => close(q, true)}>Delete</button></div>
        </div>}
      </li>)}</ul>}

    {making && <div className="modal-backdrop" onClick={() => setMaking(false)}><form className="modal quiz-modal" role="dialog" aria-modal="true" aria-label="New pop quiz" onClick={e => e.stopPropagation()} onSubmit={release}>
      <button type="button" className="modal-close" aria-label="Close" onClick={() => setMaking(false)}>×</button>
      <span className="eyebrow">POP QUIZ</span><h2>New pop quiz</h2>
      <label>Title<input autoFocus maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Equilibrium check" /></label>
      <ol className="quiz-qs">{qs.map((x, i) => <li key={i}>
        <textarea rows={2} maxLength={300} value={x.q} placeholder={`Question ${i + 1}`} aria-label={`Question ${i + 1}`} onChange={e => setQs(qs.map((y, j) => j === i ? { ...y, q: e.target.value } : y))} />
        <textarea rows={2} maxLength={600} value={x.a} placeholder="The answer they compare theirs with" aria-label={`Answer ${i + 1}`} onChange={e => setQs(qs.map((y, j) => j === i ? { ...y, a: e.target.value } : y))} />
        {qs.length > 1 && <button type="button" className="quiz-x" aria-label={`Remove question ${i + 1}`} onClick={() => setQs(qs.filter((_, j) => j !== i))}>×</button>}
      </li>)}</ol>
      {qs.length < 20 && <button type="button" className="quiz-add" onClick={() => setQs([...qs, blank()])}>+ Add a question</button>}
      <div className="quiz-opts"><label className="quiz-check"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required: it stays at the top of their recall until it's done</label>
        <label>Due<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label></div>
      <button className="primary full" disabled={busy || !ready.length}>{busy ? 'Releasing…' : `Release to ${students} student${students === 1 ? '' : 's'}`}</button>
      <p className="fineprint">Students mark their own answers against yours, like recall. You'll see each score and what they said.</p>
    </form></div>}
  </section>;
}
