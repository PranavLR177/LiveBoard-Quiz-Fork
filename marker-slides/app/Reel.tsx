'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Presentation } from './presentations';
import { SlideThumb } from './SlideFace';

/* The teacher's home: presentations sit on a tray that turns, like the carousel of a slide projector. One deck is in
   front at a time, large enough to recognise by its first slide, and everything you can do with it sits right under
   it. Drag, scroll, use the arrow keys, or tap a deck to bring it round; the strip of ticks underneath is the whole
   shelf at a glance, coloured by class. The student side has its dial of time; this is the teaching side's tray. */

const PALETTE=['var(--g5)','var(--g7)','var(--g4)','var(--g2)','var(--g6)','var(--g1)','var(--g3)'];
/** A steady colour for a class name, so a class looks the same everywhere. */
export function classColor(name:string){let h=0;for(const c of name||'')h=(h*31+c.charCodeAt(0))>>>0;return name?PALETTE[h%PALETTE.length]:'var(--line)'}

const STEP=24; // degrees between neighbouring decks on the tray

export default function Reel({decks,focus,onFocus,onOpen,renderVisual,isExample,empty}:{decks:Presentation[];focus:number;onFocus:(i:number)=>void;onOpen:(deck:Presentation)=>void;renderVisual:(type:string)=>ReactNode;isExample:(deck:Presentation)=>boolean;empty:ReactNode}){
  const stage=useRef<HTMLDivElement>(null);
  const [drag,setDrag]=useState(0); // how far the tray is being pulled, in decks
  const state=useRef({focus,count:decks.length,start:null as null|{x:number,moved:boolean},lock:false});
  state.current.focus=focus;state.current.count=decks.length;
  const go=(i:number)=>onFocus(Math.max(0,Math.min(state.current.count-1,i)));
  useEffect(()=>{
    const el=stage.current;if(!el)return;
    // a wheel or trackpad swipe turns the tray one deck at a time, not a blur of them
    const wheel=(event:WheelEvent)=>{
      const d=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
      if(Math.abs(d)<8)return;
      const s=state.current,next=s.focus+(d>0?1:-1);
      if(next<0||next>=s.count)return; // at either end, let the page scroll as usual
      event.preventDefault();
      if(s.lock)return;
      s.lock=true;go(next);setTimeout(()=>{s.lock=false},260);
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return()=>el.removeEventListener('wheel',wheel);
  },[]);
  if(!decks.length)return <div className="reel-empty">{empty}</div>;
  const width=()=>Math.max(220,(stage.current?.clientWidth||900)*0.34);
  return <div className="reel" ref={stage} tabIndex={0} role="group" aria-roledescription="carousel" aria-label="Your presentations. Use the arrow keys to turn the tray and Enter to open."
    onKeyDown={event=>{
      if(event.target!==event.currentTarget&&(event.target as HTMLElement).closest('input,select,textarea'))return;
      if(event.key==='ArrowRight'){event.preventDefault();go(focus+1)}
      else if(event.key==='ArrowLeft'){event.preventDefault();go(focus-1)}
      else if(event.key==='Home'){event.preventDefault();go(0)}
      else if(event.key==='End'){event.preventDefault();go(decks.length-1)}
      else if(event.key==='Enter'&&event.target===event.currentTarget){event.preventDefault();onOpen(decks[focus])}
    }}
    onPointerDown={event=>{if(event.button===0)state.current.start={x:event.clientX,moved:false}}}
    onPointerMove={event=>{const s=state.current.start;if(!s)return;const dx=event.clientX-s.x;if(Math.abs(dx)>6){s.moved=true;event.currentTarget.setPointerCapture(event.pointerId)}if(s.moved)setDrag(-dx/width())}}
    onPointerUp={()=>{const s=state.current.start;state.current.start=null;if(s?.moved){go(Math.round(focus+drag));setDrag(0);setTimeout(()=>{state.current.start=null},0)}}}
    onPointerCancel={()=>{state.current.start=null;setDrag(0)}}>
    <ul className={'reel-tray'+(drag?' dragging':'')}>
      {decks.map((deck,i)=>{
        const d=i-focus-drag;
        if(Math.abs(d)>4.5)return null;
        const a=d*STEP*Math.PI/180;
        // on a circle seen from outside: neighbours swing back, turn away and shrink. Each card carries its own perspective
        // so the stacking order is plain z-index (nearest the front on top), which every browser agrees on.
        const style={transform:`perspective(1500px) translateX(calc(${Math.sin(a).toFixed(4)} * var(--reel-r))) translateZ(calc(${(Math.cos(a)-1).toFixed(4)} * var(--reel-r))) rotateY(${(d*STEP*0.6).toFixed(2)}deg) scale(${(1-Math.min(Math.abs(d),3)*0.12).toFixed(3)})`,zIndex:100-Math.round(Math.abs(d)*10),opacity:Math.abs(d)>3.5?0:1,'--cc':classColor(deck.className)} as any;
        const front=i===focus;
        return <li key={deck.id} className={'reel-card'+(front?' front':'')} style={style} aria-hidden={!front&&Math.abs(d)>2.5}>
          <button className="deck-cover" tabIndex={front?0:-1} aria-label={(front?'Open presentation: ':'Bring to the front: ')+deck.title}
            onClick={event=>{if(state.current.start?.moved){event.preventDefault();return}front?onOpen(deck):onFocus(i)}}>
            {deck.slides[0]&&<SlideThumb slide={deck.slides[0]} renderVisual={renderVisual}/>}
            <span className="deck-count">{deck.slides.length} slide{deck.slides.length===1?'':'s'}</span>{isExample(deck)&&<span className="deck-example">Example</span>}
            {!!deck.lastSession?.open&&<span className="deck-waiting" title="Questions from class still open">{deck.lastSession.open} open</span>}
          </button>
          <span className="reel-label"><i/>{deck.title}</span>
        </li>;
      })}
    </ul>
    <button className="reel-turn prev" aria-label="Previous presentation" disabled={focus<=0} onClick={()=>go(focus-1)}>‹</button>
    <button className="reel-turn next" aria-label="Next presentation" disabled={focus>=decks.length-1} onClick={()=>go(focus+1)}>›</button>
  </div>;
}

/** The whole shelf as a strip of ticks, coloured by class; the one in front is taller. Tap one to bring it round. */
export function ReelStrip({decks,focus,onFocus}:{decks:Presentation[];focus:number;onFocus:(i:number)=>void}){
  if(decks.length<2)return null;
  return <div className="reel-strip" role="group" aria-label="All presentations">
    {decks.map((deck,i)=><button key={deck.id} className={i===focus?'on':''} style={{'--cc':classColor(deck.className)} as any} title={deck.title+(deck.className?' · '+deck.className:'')} aria-label={deck.title} aria-current={i===focus?'true':undefined} onClick={()=>onFocus(i)}/>)}
    <span>{focus+1} of {decks.length}</span>
  </div>;
}
