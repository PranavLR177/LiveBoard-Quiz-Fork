'use client';
import { useEffect, useRef, useState } from 'react';
import { classesBackend, type QuizQuestion, type QuizResult, type TeacherQuiz } from './classesApi';

/* Pop quizzes for one class. A teacher builds a few questions and releases them: every student in the class gets
   them pushed to LiveBoard at once, at the top of their recall (required ones stay there until done). Here the teacher
   sees who has done it, the scores and what each student said or picked.
   Kinds of question:
     Short answer     answered from memory (typed or out loud) and self-marked against the teacher's answer
     Multiple choice  2 to 6 options, one right; marked by the server from what was picked
     True or false    marked by the server
   Any question can carry a picture (shrunk on this device to a small image before it's sent) and, for the marked
   kinds, an explanation shown after answering. A quiz can shuffle its questions and options for each student.
   Students still see the right answer once they've answered, so it's a check-in on what stuck, not a secure test. */

type Kind = 'short' | 'choice' | 'tf';
type Draft = { kind: Kind; q: string; a: string; options: string[]; correct: number; img: string; key: number };
let keys = 0;
const blank = (kind: Kind = 'short'): Draft => ({ kind, q: '', a: '', options: ['', '', '', ''], correct: kind === 'tf' ? 0 : -1, img: '', key: ++keys });
const tomorrow = () => { const d = new Date(Date.now() + 864e5); d.setHours(17, 0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const dueText = (iso: string | null) => { if (!iso) return 'no due time'; const d = new Date(iso), h = Math.round((d.getTime() - Date.now()) / 36e5); return h < 0 ? 'past due' : h < 24 ? `due in ${Math.max(1, h)}h` : `due ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`; };
const KINDS: { id: Kind; label: string }[] = [{ id: 'short', label: 'Short answer' }, { id: 'choice', label: 'Multiple choice' }, { id: 'tf', label: 'True or false' }];
const LETTER = 'ABCDEF';
const MAX_IMG = 270000; // characters of data: URL, about 200 KB; the server refuses anything bigger

/** Shrinks a picture to at most 1000px on its long side and about 200 KB, as a data: URL. */
async function shrink(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw Error('That isn’t a picture.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error('Couldn’t read that picture.')); i.src = url; });
    for (const [side, q] of [[1000, .82], [800, .74], [640, .66], [480, .6]] as const) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/jpeg', q);
      if (out.length <= MAX_IMG) return out;
    }
    throw Error('That picture is too detailed to send. Try a smaller one.');
  } finally { URL.revokeObjectURL(url); }
}

function toQuestion(d: Draft): QuizQuestion | null {
  const q = d.q.trim();
  if (!q && !d.img) return null;
  if (d.kind === 'short') return { type: 'short', q, a: d.a.trim(), ...(d.img ? { img: d.img } : {}) };
  if (d.kind === 'tf') return { type: 'tf', q, a: d.a.trim(), correct: d.correct === 1 ? 1 : 0, ...(d.img ? { img: d.img } : {}) };
  // only filled options count; the right one is re-indexed among them
  const kept = d.options.map((o, i) => ({ o: o.trim(), i })).filter(x => x.o);
  return { type: 'choice', q, a: d.a.trim(), options: kept.map(x => x.o), correct: kept.findIndex(x => x.i === d.correct), ...(d.img ? { img: d.img } : {}) };
}
/** What's missing from a question, or '' if it's ready. */
function problem(d: Draft): string {
  if (!d.q.trim() && !d.img) return '';
  if (d.kind === 'choice') {
    const filled = d.options.filter(o => o.trim()).length;
    if (filled < 2) return 'Give at least two options.';
    if (d.correct < 0 || !d.options[d.correct]?.trim()) return 'Mark the right option.';
  }
  return '';
}

export default function QuizPanel({ classId, students }: { classId: string; students: number }) {
  const api = classesBackend();
  const [list, setList] = useState<TeacherQuiz[] | null>(null);
  const [open, setOpen] = useState('');
  const [results, setResults] = useState<QuizResult[] | null>(null);
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState('');
  const [qs, setQs] = useState<Draft[]>([blank(), blank('choice')]);
  const [required, setRequired] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [due, setDue] = useState(tomorrow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const files = useRef<Record<number, HTMLInputElement | null>>({});

  const load = () => api?.quizzes(classId).then(setList).catch(e => setError(e.message));
  useEffect(() => { setList(null); setOpen(''); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [classId]);
  useEffect(() => { setResults(null); if (api && open) api.quizResults(open).then(setResults).catch(e => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const set = (i: number, patch: Partial<Draft>) => setQs(qs.map((d, j) => j === i ? { ...d, ...patch } : d));
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= qs.length) return; const next = [...qs]; [next[i], next[j]] = [next[j], next[i]]; setQs(next); };
  const ready = qs.map(toQuestion).filter(Boolean) as QuizQuestion[];
  const firstProblem = qs.map((d, i) => [i, problem(d)] as const).find(([, p]) => p);

  async function addPicture(i: number, file?: File) {
    if (!file) return;
    try { set(i, { img: await shrink(file) }); setFormError(''); } catch (e) { setFormError(e instanceof Error ? e.message : 'Couldn’t add that picture.'); }
  }
  async function release(e: React.FormEvent) {
    e.preventDefault(); if (!api || !ready.length) return;
    if (firstProblem) { setFormError(`Question ${firstProblem[0] + 1}: ${firstProblem[1]}`); return; }
    setBusy(true); setError(''); setFormError('');
    try {
      await api.releaseQuiz(classId, title.trim() || 'Pop quiz', ready, required, due ? new Date(due).toISOString() : null, shuffle);
      setMaking(false); setTitle(''); setQs([blank(), blank('choice')]); setDue(tomorrow()); setShuffle(false); await load();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not release the quiz.'); }
    finally { setBusy(false); }
  }
  async function close(q: TeacherQuiz, remove: boolean) {
    if (!api) return;
    try { await api.closeQuiz(q.id, remove); if (remove && open === q.id) setOpen(''); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not change the quiz.'); }
  }
  const saidFor = (q: TeacherQuiz, i: number, a: QuizResult['answers'][number]) => {
    const item = q.items?.[i];
    if (item && (item.type === 'choice' || item.type === 'tf') && typeof a.pick === 'number') return `${LETTER[a.pick] || '?'}. ${item.options?.[a.pick] ?? ''}`;
    return a.said || '(nothing typed)';
  };

  return <section className="quiz-panel" aria-label="Pop quizzes">
    <div className="quiz-top"><p className="quiet">Students see it at the top of their recall.</p>
      <button className="primary" onClick={() => setMaking(true)} disabled={!students} title={students ? '' : 'No students in this class yet'}>New pop quiz</button></div>
    {error && <p role="alert" className="class-error">{error} <button onClick={() => setError('')}>Dismiss</button></p>}
    {list === null ? <p className="quiet">Loading quizzes…</p> : !list.length ? <p className="class-none">No pop quizzes yet.</p> :
      <ul className="quiz-list">{list.map(q => <li key={q.id} className={'quiz-card' + (q.closed ? ' closed' : '') + (open === q.id ? ' open' : '')}>
        <button className="quiz-row" aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? '' : q.id)}>
          <span className="quiz-name"><b>{q.title}</b><small>{q.questions} question{q.questions === 1 ? '' : 's'} · {q.required ? 'required' : 'optional'}{q.shuffle ? ' · shuffled' : ''} · {q.closed ? 'closed' : dueText(q.dueAt)}</small></span>
          <span className="quiz-done"><span className="roster-bar" aria-hidden="true"><u style={{ width: (q.students ? Math.round(100 * q.done / q.students) : 0) + '%' }} /></span><small>{q.done} of {q.students} done</small></span>
          <span className="quiz-avg">{q.avgPct == null ? '–' : q.avgPct + '%'}<small>average</small></span>
        </button>
        {open === q.id && <div className="quiz-results">
          {results === null ? <p className="quiet">Loading…</p> : <table className="roster"><thead><tr><th>Student</th><th>Score</th><th>What they said or picked</th></tr></thead>
            <tbody>{results.map(r => <tr key={r.userId}><td><span className="roster-name"><i>{r.name.slice(0, 1).toUpperCase()}</i>{r.name}</span></td>
              <td>{r.done ? <b>{r.score} / {r.total}</b> : <span className="quiet">not yet</span>}</td>
              <td>{r.done ? <div className="quiz-said">{r.answers.map((a, i) => <span key={i} data-got={a.got}>{i + 1}. {saidFor(q, i, a)}</span>)}</div> : null}</td></tr>)}</tbody></table>}
          <div className="quiz-acts">{!q.closed && <button onClick={() => close(q, false)}>Close it</button>}<button className="class-delete" onClick={() => close(q, true)}>Delete</button></div>
        </div>}
      </li>)}</ul>}

    {making && <div className="modal-backdrop" onClick={() => setMaking(false)}><form className="modal quiz-modal" role="dialog" aria-modal="true" aria-label="New pop quiz" onClick={e => e.stopPropagation()} onSubmit={release}>
      <button type="button" className="modal-close" aria-label="Close" onClick={() => setMaking(false)}>×</button>
      <span className="eyebrow">POP QUIZ</span><h2>New pop quiz</h2>
      <label>Title<input autoFocus maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Equilibrium check" /></label>
      <ol className="quiz-qs">{qs.map((d, i) => <li key={d.key} className="qb" data-kind={d.kind}>
        <div className="qb-head"><b>Q{i + 1}</b>
          <div className="qb-kinds" role="radiogroup" aria-label={`Question ${i + 1} kind`}>{KINDS.map(k => <button type="button" role="radio" key={k.id} aria-checked={d.kind === k.id} onClick={() => set(i, { kind: k.id, correct: k.id === 'tf' ? (d.correct === 1 ? 1 : 0) : d.kind === 'choice' ? d.correct : -1 })}>{k.label}</button>)}</div>
          <span className="qb-tools">
            <button type="button" aria-label={`Move question ${i + 1} up`} title="Move up" disabled={!i} onClick={() => move(i, -1)}>↑</button>
            <button type="button" aria-label={`Move question ${i + 1} down`} title="Move down" disabled={i === qs.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" aria-label={`Copy question ${i + 1}`} title="Copy" disabled={qs.length >= 20} onClick={() => { const next = [...qs]; next.splice(i + 1, 0, { ...d, options: [...d.options], key: ++keys }); setQs(next); }}>⧉</button>
            {qs.length > 1 && <button type="button" aria-label={`Remove question ${i + 1}`} title="Remove" onClick={() => setQs(qs.filter((_, j) => j !== i))}>×</button>}
          </span></div>
        <div className="qb-body">
          <textarea rows={2} maxLength={300} value={d.q} placeholder={d.kind === 'tf' ? 'A statement that’s true or false' : `Question ${i + 1}`} aria-label={`Question ${i + 1}`} onChange={e => set(i, { q: e.target.value })} />
          {d.img ? <figure className="qb-img"><img src={d.img} alt={`Picture for question ${i + 1}`} /><button type="button" onClick={() => set(i, { img: '' })}>Remove picture</button></figure>
            : <button type="button" className="qb-addimg" onClick={() => files.current[d.key]?.click()}>+ Picture</button>}
          <input ref={el => { files.current[d.key] = el; }} type="file" accept="image/*" hidden onChange={e => { void addPicture(i, e.target.files?.[0]); e.target.value = ''; }} />
          {d.kind === 'choice' && <div className="qb-opts" role="radiogroup" aria-label={`Options for question ${i + 1}; choose the right one`}>
            {d.options.map((o, k) => <div key={k} className={'qb-opt' + (d.correct === k ? ' right' : '')}>
              <button type="button" role="radio" aria-checked={d.correct === k} aria-label={`Option ${LETTER[k]} is right`} title="Mark as the right answer" onClick={() => set(i, { correct: k })}>{d.correct === k ? '✓' : LETTER[k]}</button>
              <input maxLength={120} value={o} placeholder={`Option ${LETTER[k]}`} aria-label={`Option ${LETTER[k]}`} onChange={e => set(i, { options: d.options.map((x, j) => j === k ? e.target.value : x) })} />
              {d.options.length > 2 && <button type="button" className="qb-x" aria-label={`Remove option ${LETTER[k]}`} onClick={() => set(i, { options: d.options.filter((_, j) => j !== k), correct: d.correct === k ? -1 : d.correct > k ? d.correct - 1 : d.correct })}>×</button>}
            </div>)}
            {d.options.length < 6 && <button type="button" className="quiz-add" onClick={() => set(i, { options: [...d.options, ''] })}>+ Option</button>}
          </div>}
          {d.kind === 'tf' && <div className="qb-tf" role="radiogroup" aria-label={`Question ${i + 1}: the right answer`}>
            {['True', 'False'].map((t, k) => <button type="button" role="radio" key={t} aria-checked={d.correct === k} onClick={() => set(i, { correct: k })}>{t}</button>)}</div>}
          <textarea rows={2} maxLength={600} value={d.a} placeholder={d.kind === 'short' ? 'The answer they compare theirs with' : 'Why (shown after they answer, optional)'} aria-label={d.kind === 'short' ? `Answer ${i + 1}` : `Explanation ${i + 1}`} onChange={e => set(i, { a: e.target.value })} />
          {problem(d) && <small className="qb-warn">{problem(d)}</small>}
        </div>
      </li>)}</ol>
      {qs.length < 20 && <div className="quiz-adds">{KINDS.map(k => <button key={k.id} type="button" className="quiz-add" onClick={() => setQs([...qs, blank(k.id)])}>+ {k.label}</button>)}</div>}
      <div className="quiz-opts">
        <label className="quiz-check"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required: it stays at the top of their recall until it's done</label>
        <label className="quiz-check"><input type="checkbox" checked={shuffle} onChange={e => setShuffle(e.target.checked)} /> Shuffle the questions and options for each student</label>
        <label>Due<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label></div>
      {formError && <p role="alert" className="class-error">{formError}</p>}
      <button className="primary full" disabled={busy || !ready.length}>{busy ? 'Releasing…' : `Release ${ready.length} question${ready.length === 1 ? '' : 's'} to ${students} student${students === 1 ? '' : 's'}`}</button>
      <p className="fineprint">Multiple choice and true or false are marked for them; short answers they mark against yours. You'll see each score and what they said or picked.</p>
    </form></div>}
  </section>;
}
