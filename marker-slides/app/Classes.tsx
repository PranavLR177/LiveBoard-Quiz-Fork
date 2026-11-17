'use client';
import { useEffect, useState } from 'react';
import TopBar from './TopBar';
import { classesBackend, type RosterRow, type StudentWork, type TeacherClass } from './classesApi';
import { classColor } from './Reel';

/* A teacher's classes: who is in each one and how they are doing. Students join with the class code in LiveBoard
   (Classes, then the code); joining shares the notes and markers in the course they link, read-only, and leaving
   stops it. Nothing here can change a student's work. */

const NAME_KEY='lb-teacher-name';
const ago=(ms:number|null)=>{if(!ms)return'no notes yet';const d=Math.floor((Date.now()-ms)/864e5);return d<=0?'today':d===1?'yesterday':d<30?d+' days ago':new Date(ms).toLocaleDateString()};
const pct=(a:number,b:number)=>b?Math.round(100*a/b):0;
const MASTERY=['Unsure','Getting it','Mastered'];

export default function Classes(){
  const api=classesBackend();
  const [account,setAccount]=useState<{email:string}|null|undefined>(undefined);
  const [classes,setClasses]=useState<TeacherClass[]>([]);
  const [sel,setSel]=useState('');
  const [roster,setRoster]=useState<RosterRow[]|null>(null);
  const [student,setStudent]=useState<RosterRow|null>(null);
  const [work,setWork]=useState<StudentWork|null>(null);
  const [openNote,setOpenNote]=useState('');
  const [making,setMaking]=useState(false);
  const [name,setName]=useState('');
  const [teacher,setTeacher]=useState(()=>{try{return localStorage.getItem(NAME_KEY)||''}catch{return''}});
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [copied,setCopied]=useState(false);

  async function refresh(keep=sel){
    if(!api)return;
    const list=await api.list();
    setClasses(list);
    const next=list.find(c=>c.id===keep)?keep:list[0]?.id||'';
    setSel(next);
  }
  useEffect(()=>{
    if(!api){setAccount(null);return}
    api.account().then(a=>{setAccount(a);if(a)return refresh().catch(e=>setError(e.message))}).catch(()=>setAccount(null));
    // coming back to the tab picks up students who joined meanwhile; nothing asks on a timer
    const back=()=>{if(document.visibilityState==='visible')refresh().catch(()=>{})};
    document.addEventListener('visibilitychange',back);
    return()=>document.removeEventListener('visibilitychange',back);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    setStudent(null);setWork(null);setRoster(null);setConfirmDelete(false);
    if(!api||!sel)return;
    let gone=false;
    api.roster(sel).then(r=>{if(!gone)setRoster(r)}).catch(e=>{if(!gone)setError(e.message)});
    return()=>{gone=true};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sel]);
  useEffect(()=>{
    setWork(null);setOpenNote('');
    if(!api||!student||!sel||!student.shares)return;
    let gone=false;
    api.work(sel,student.userId).then(w=>{if(!gone)setWork(w)}).catch(e=>{if(!gone)setError(e.message)});
    return()=>{gone=true};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[student]);

  async function make(event:React.FormEvent){
    event.preventDefault();if(!api||!name.trim())return;
    setBusy(true);setError('');
    try{try{localStorage.setItem(NAME_KEY,teacher.trim())}catch{}const r=await api.create(name.trim(),teacher.trim());setMaking(false);setName('');await refresh(r.id)}
    catch(e){setError(e instanceof Error?e.message:'Could not make the class.')}
    finally{setBusy(false)}
  }
  async function remove(){
    if(!api||!current)return;
    setBusy(true);
    try{await api.remove(current.id);await refresh('')}catch(e){setError(e instanceof Error?e.message:'Could not delete the class.')}finally{setBusy(false);setConfirmDelete(false)}
  }
  const current=classes.find(c=>c.id===sel);
  const signIn=new URL('./#account',location.href).href;

  return <><TopBar role="teacher" here="classes"/><main className="class-home">
    <header className="library-header"><div><h1>Classes</h1><p className="library-stats">Your students, their notes and markers, and how they're doing.</p></div>
      {account&&<div className="library-header-actions"><button className="primary" onClick={()=>setMaking(true)}>New class</button></div>}
    </header>
    {error&&<p role="alert" className="class-error">{error} <button onClick={()=>setError('')}>Dismiss</button></p>}

    {!api?<section className="class-empty"><h2>Classes need LiveBoard accounts</h2><p>This copy of LiveBoard isn't connected to its server (Supabase), so there's nowhere to keep a class. Presentations and live lessons by code still work.</p></section>
    :account===undefined?<p className="class-empty">Loading…</p>
    :!account?<section className="class-empty"><h2>Sign in to make classes</h2><p>A class lives on your LiveBoard account, so your students can join it from any device. Sign in once and it works here too.</p><a className="primary" href={signIn}>Sign in to LiveBoard</a></section>
    :!classes.length&&!making?<section className="class-empty"><h2>No classes yet</h2><p>Make a class, then give your students its code. They join in LiveBoard under Classes. They'll see when you start a live lesson for the class, and you'll see their notes and markers for it.</p><button className="primary" onClick={()=>setMaking(true)}>Make your first class</button></section>
    :<div className="class-layout">
      <nav className="class-list" aria-label="Your classes">
        {classes.map(c=><button key={c.id} className={'class-pick'+(c.id===sel?' on':'')} style={{'--cc':classColor(c.name)} as any} aria-current={c.id===sel?'true':undefined} onClick={()=>setSel(c.id)}>
          <b>{c.name}</b><small><i/>{c.students} student{c.students===1?'':'s'} · {c.code}</small>{c.liveRoom&&<em className="class-live">Live</em>}
        </button>)}
      </nav>
      {current&&<section className="class-detail" style={{'--cc':classColor(current.name)} as any} aria-label={current.name}>
        <div className="class-head">
          <div><span className="eyebrow">CLASS</span><h2>{current.name}</h2>
            {current.liveRoom&&<p className="class-livebar"><i/>Live now: {current.liveTitle||'a lesson'} · room {current.liveRoom}</p>}</div>
          <div className="class-code"><small>Join code</small><b>{current.code}</b><button onClick={()=>navigator.clipboard?.writeText(current.code).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1600)}).catch(()=>{})}>{copied?'Copied':'Copy'}</button></div>
        </div>
        <p className="class-how">Students open <b>Classes</b> in LiveBoard and enter <b>{current.code}</b>. Joining links one of their courses and shares its notes and markers with you, read-only. They can leave at any time.</p>
        {roster===null?<p className="quiet">Loading students…</p>:!roster.length?<p className="class-none">No students yet. Share the code above.</p>:
        <div className={'class-body'+(student?' with-student':'')}>
          <table className="roster"><thead><tr><th>Student</th><th>Notes</th><th>Markers</th><th>Mastered</th><th>To review</th><th>Points <small>7d</small></th><th>Last active</th></tr></thead>
          <tbody>{roster.map(r=><tr key={r.userId} className={student?.userId===r.userId?'on':''} onClick={()=>setStudent(r)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStudent(r)}}} aria-selected={student?.userId===r.userId}>
            <td><span className="roster-name"><i>{r.name.slice(0,1).toUpperCase()}</i>{r.name}</span>{!r.shares&&<small className="roster-private">not sharing</small>}</td>
            <td>{r.shares?r.notes:'–'}</td><td>{r.shares?r.markers:'–'}</td>
            <td>{r.shares&&r.markers?<span className="roster-bar" title={`${r.mastered} of ${r.markers}`}><u style={{width:pct(r.mastered,r.markers)+'%'}}/></span>:'–'}{r.shares&&r.markers?<small> {pct(r.mastered,r.markers)}%</small>:''}</td>
            <td>{r.shares?r.due:'–'}</td><td>{r.points}</td><td>{r.shares?ago(r.lastActive):'–'}</td>
          </tr>)}</tbody></table>
          {student&&<aside className="student-work" aria-label={student.name+"'s work"}>
            <header><b>{student.name}</b><button className="modal-close" aria-label="Close" onClick={()=>setStudent(null)}>×</button></header>
            {!student.shares?<p className="quiet">{student.name} isn't sharing notes with this class.</p>
            :work===null?<p className="quiet">Loading…</p>
            :<>
              <div className="work-stats"><span><b>{work.notes.length}</b>notes</span><span><b>{work.markers.length}</b>markers</span><span><b>{pct(work.markers.filter(m=>m.mastery===2).length,work.markers.length)}%</b>mastered</span></div>
              <h3>Notes</h3>
              {work.notes.length?<ul className="work-notes">{work.notes.map(n=><li key={n.id}><button aria-expanded={openNote===n.id} onClick={()=>setOpenNote(openNote===n.id?'':n.id)}><b>{n.title||'Untitled note'}</b><small>{ago(n.updated)} · {work.markers.filter(m=>m.noteId===n.id).length} markers</small></button>
                {openNote===n.id&&<div className="work-text">{n.text?n.text.slice(0,4000):'(empty)'}{n.text.length>4000?'…':''}</div>}</li>)}</ul>:<p className="quiet">No notes in this class yet.</p>}
              <h3>Markers</h3>
              {work.markers.length?<ul className="work-markers">{work.markers.slice(0,60).map(m=><li key={m.id} data-mastery={m.mastery??0}><span className="work-type">{m.type}</span><p>{m.text||'(a marker on blank space)'}</p><small>{MASTERY[m.mastery??0]||'Unsure'}{m.understanding?' · '+m.understanding:''}</small></li>)}</ul>:<p className="quiet">No markers yet.</p>}
            </>}
          </aside>}
        </div>}
        <footer className="class-foot">{confirmDelete?<><span>Delete {current.name}? Students leave it; their notes stay theirs.</span><button className="danger" disabled={busy} onClick={remove}>Delete class</button><button onClick={()=>setConfirmDelete(false)}>Keep it</button></>:<button className="class-delete" onClick={()=>setConfirmDelete(true)}>Delete class…</button>}</footer>
      </section>}
    </div>}

    {making&&<div className="modal-backdrop" onClick={()=>setMaking(false)}><form className="modal" role="dialog" aria-modal="true" aria-label="New class" onClick={e=>e.stopPropagation()} onSubmit={make}>
      <button type="button" className="modal-close" aria-label="Close" onClick={()=>setMaking(false)}>×</button>
      <span className="eyebrow">NEW CLASS</span><h2>Make a class</h2>
      <label>Class name<input autoFocus required maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. AP Chemistry, period 3"/></label>
      <label>Your name, as students see it<input maxLength={40} value={teacher} onChange={e=>setTeacher(e.target.value)} placeholder="e.g. Ms Rivera"/></label>
      <button className="primary full" disabled={busy||!name.trim()}>{busy?'Making…':'Make class'}</button>
      <p className="fineprint">You'll get a code to give your students.</p>
    </form></div>}
  </main></>;
}
