import { useEffect, useState, type ReactNode } from 'react';
import { isDark, onTheme, toggleTheme } from '../../src/theme';
import { notesLink,notesUrl } from './notesLink';

/* The same top bar as the notes side of LiveBoard (index.html): mark and wordmark, where you are, light or dark,
   and the way across to the other side. One bar on every classroom screen, so the two halves read as one app. */
export default function TopBar({role,here,onHome,status,children}:{role:'teacher'|'student'|'projector';here?:'library'|'deck';onHome?:()=>void;status?:ReactNode;children?:ReactNode}){
  const [dark,setDark]=useState(false);
  useEffect(()=>{setDark(isDark());const off=onTheme(()=>setDark(isDark()));return()=>{off()}},[]);
  const home=role==='teacher'?location.pathname+'?view=library':notesUrl()||location.pathname;
  const worksheets=notesLink('teacher','#teacher'),notes=role==='teacher'?notesLink('student'):notesUrl(); // a student or individual goes back as whoever they are
  return <header className="lb-top">
    <a className="lb-brand" href={home} aria-label={role==='teacher'?'LiveBoard: all presentations':'LiveBoard home'} onClick={event=>{if(role==='teacher'&&onHome){event.preventDefault();onHome()}}}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v3"/></svg><span className="lb-brandname">LiveBoard</span></a>
    {role==='teacher'&&here==='deck'&&<a className="lb-back" href={home} onClick={event=>{if(onHome){event.preventDefault();onHome()}}}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 3.500 5 8l4.500 4.500"/></svg>All presentations</a>}
    {status&&<span className="lb-status">{status}</span>}
    <span className="lb-spacer"/>
    {role==='teacher'&&here!=='deck'&&<a className="lb-btn lb-home" href={home} aria-current={here==='library'?'page':undefined} title="Your presentations and live classes" onClick={event=>{if(onHome){event.preventDefault();onHome()}}}>Presentations</a>}
    {role==='teacher'&&worksheets&&<a className="lb-btn" href={worksheets} title="Turn a PDF or document into a worksheet with marker questions and hints">Worksheets</a>}
    {children}
    {role!=='projector'&&<button className="lb-iconbtn" onClick={toggleTheme} aria-label={dark?'Switch to light mode':'Switch to dark mode'} title="Light or dark">
      {dark?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/></svg>
      :<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>}</button>}
    {role==='teacher'&&notes&&<a className="lb-pill" href={notes} title="Use LiveBoard as a student on this device">Student notes</a>}
    {role==='student'&&notes&&<a className="lb-pill" href={notes} title="Back to your notes">My notes</a>}
  </header>;
}
