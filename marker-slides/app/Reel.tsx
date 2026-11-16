'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Slide } from './data';
import { SlideThumb } from './SlideFace';

/* A tray that turns, like the carousel of a slide projector: one slide is in front, large enough to read, and the
   ones after it curve away behind. On the teacher's home it holds the slides of the presentation in front (the one
   opened most recently); the other presentations wait below and are pulled up by scrolling (PresentationLibrary).
   Drag, swipe sideways, use the left and right arrow keys, or tap a slide to bring it round; the strip of ticks
   underneath is the whole deck at a glance. The student side has its dial of time; this is the teaching side's tray. */
export type ReelItem={id:string;slide:Slide;label:string;tag?:string};

const PALETTE=['var(--g5)','var(--g7)','var(--g4)','var(--g2)','var(--g6)','var(--g1)','var(--g3)'];
/** A steady colour for a class name, so a class looks the same everywhere. */
export function classColor(name:string){let h=0;for(const c of name||'')h=(h*31+c.charCodeAt(0))>>>0;return name?PALETTE[h%PALETTE.length]:'var(--line)'}

const STEP=24; // degrees between neighbouring decks on the tray

export default function Reel({items,focus,onFocus,onOpen,renderVisual,color,label}:{items:ReelItem[];focus:number;onFocus:(i:number)=>void;onOpen:(index:number)=>void;renderVisual:(type:string)=>ReactNode;color:string;label:string}){
  const stage=useRef<HTMLDivElement>(null);
  const [drag,setDrag]=useState(0); // how far the tray is being pulled, in decks
  const state=useRef({focus,count:items.length,start:null as null|{x:number,moved:boolean},lock:false});
  state.current.focus=focus;state.current.count=items.length;
  const go=(i:number)=>onFocus(Math.max(0,Math.min(state.current.count-1,i)));
  useEffect(()=>{
    const el=stage.current;if(!el)return;
    // a sideways swipe on a trackpad (or shift + wheel) turns the tray one slide at a time. Up and down is left alone:
    // that pulls the next presentation up.
    const wheel=(event:WheelEvent)=>{
      const sideways=Math.abs(event.deltaX)>Math.abs(event.deltaY)||event.shiftKey;
      if(!sideways)return;
      const d=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
      if(Math.abs(d)<8)return;
      const s=state.current,next=s.focus+(d>0?1:-1);
      if(next<0||next>=s.count)return;
      event.preventDefault();
      if(s.lock)return;
      s.lock=true;go(next);setTimeout(()=>{s.lock=false},260);
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return()=>el.removeEventListener('wheel',wheel);
  },[]);
  if(!items.length)return null;
  const width=()=>Math.max(220,(stage.current?.clientWidth||900)*0.34);
  return <div className="reel" ref={stage} tabIndex={0} role="group" aria-roledescription="carousel" aria-label={label+". Use the left and right arrow keys to turn through the slides, and Enter to open."}
    onKeyDown={event=>{
      if(event.target!==event.currentTarget&&(event.target as HTMLElement).closest('input,select,textarea'))return;
      if(event.key==='ArrowRight'){event.preventDefault();go(focus+1)}
      else if(event.key==='ArrowLeft'){event.preventDefault();go(focus-1)}
      else if(event.key==='Home'){event.preventDefault();go(0)}
      else if(event.key==='End'){event.preventDefault();go(items.length-1)}
      else if(event.key==='Enter'&&event.target===event.currentTarget){event.preventDefault();onOpen(focus)}
    }}
    onPointerDown={event=>{if(event.button===0)state.current.start={x:event.clientX,moved:false}}}
    onPointerMove={event=>{const s=state.current.start;if(!s)return;const dx=event.clientX-s.x;if(Math.abs(dx)>6){s.moved=true;event.currentTarget.setPointerCapture(event.pointerId)}if(s.moved)setDrag(-dx/width())}}
    onPointerUp={()=>{const s=state.current.start;state.current.start=null;if(s?.moved){go(Math.round(focus+drag));setDrag(0);setTimeout(()=>{state.current.start=null},0)}}}
    onPointerCancel={()=>{state.current.start=null;setDrag(0)}}>
    <ul className={'reel-tray'+(drag?' dragging':'')}>
      {items.map((item,i)=>{
        const d=i-focus-drag;
        if(Math.abs(d)>4.5)return null;
        const a=d*STEP*Math.PI/180;
        // on a circle seen from outside: neighbours swing back, turn away and shrink. Each card carries its own perspective
        // so the stacking order is plain z-index (nearest the front on top), which every browser agrees on.
        const style={transform:`perspective(1500px) translateX(calc(${Math.sin(a).toFixed(4)} * var(--reel-r))) translateZ(calc(${(Math.cos(a)-1).toFixed(4)} * var(--reel-r))) rotateY(${(d*STEP*0.6).toFixed(2)}deg) scale(${(1-Math.min(Math.abs(d),3)*0.12).toFixed(3)})`,zIndex:100-Math.round(Math.abs(d)*10),opacity:Math.abs(d)>3.5?0:1,'--cc':color} as any;
        const front=i===focus;
        return <li key={item.id} className={'reel-card'+(front?' front':'')} style={style} aria-hidden={!front&&Math.abs(d)>2.5}>
          <button className="deck-cover" tabIndex={front?0:-1} aria-label={(front?'Open at ':'Bring to the front: ')+item.label}
            onClick={event=>{if(state.current.start?.moved){event.preventDefault();return}front?onOpen(i):onFocus(i)}}>
            <SlideThumb slide={item.slide} renderVisual={renderVisual}/>
            <span className="deck-count">{i+1}</span>{item.tag&&<span className="deck-example">{item.tag}</span>}
          </button>
          <span className="reel-label">{item.label}</span>
        </li>;
      })}
    </ul>
    <button className="reel-turn prev" aria-label="Previous slide" disabled={focus<=0} onClick={()=>go(focus-1)}>‹</button>
    <button className="reel-turn next" aria-label="Next slide" disabled={focus>=items.length-1} onClick={()=>go(focus+1)}>›</button>
  </div>;
}

/** The whole deck as a strip of ticks; the one in front is taller. Tap one to bring that slide round. */
export function ReelStrip({items,focus,onFocus,color}:{items:ReelItem[];focus:number;onFocus:(i:number)=>void;color:string}){
  if(items.length<2)return null;
  return <div className="reel-strip" role="group" aria-label="All slides in this presentation" style={{'--cc':color} as any}>
    {items.map((item,i)=><button key={item.id} className={i===focus?'on':''} title={item.label} aria-label={item.label} aria-current={i===focus?'true':undefined} onClick={()=>onFocus(i)}/>)}
    <span>Slide {focus+1} of {items.length}</span>
  </div>;
}
