'use client';
import { go,link } from './nav';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { deletePresentation,listPresentations,savePresentation,type Presentation } from './presentations';
import { importAccept,importPresentation } from './importPresentation';
import { newLessons } from './newLessons';
import { initialSlides } from './data';
import { SlideFace,SlideThumb } from './SlideFace';
import TopBar from './TopBar';
import Reel,{ReelStrip,classColor,type ReelItem} from './Reel';

/* The teacher's home: every presentation in this browser.

   What it is for, beyond listing decks:
   - Slides viewer. Opening a cover shows the whole deck as one slow, eased scroll, so a teacher can read through a
     lesson the way they would flip through a printout, and step into the editor at any slide.
   - After class. A deck that has been taught live keeps what the class asked (see page.tsx, rememberSession). The card
     says how many questions came in and how many were left open, and Review class lists them slide by slide, shows
     which slides drew the most, and saves them as a file for planning the next lesson.
   - Finding things. Search across title, class, unit and topic; filters appear only for the labels actually in use. */

type Group='className'|'unit'|'topic';
type Order='updated'|'title'|Group;
const groups:[Group,string][]=[['className','Class'],['unit','Unit'],['topic','Topic']];
const isExample=(deck:Presentation)=>deck.id.startsWith('sample-classroom-');
const ago=(at:number)=>{const d=Math.floor((Date.now()-at)/864e5);return d<=0?'today':d===1?'yesterday':d<30?d+' days ago':new Date(at).toLocaleDateString()};

/** Wheel and key scrolling that eases instead of jumping: the wheel moves the target a fraction of what it normally
 *  would and the view glides after it. Touch and scrollbar dragging are left to the browser. */
function useSlowScroll(ref:React.RefObject<HTMLDivElement|null>,enabled:boolean,onIndex:(index:number)=>void) {
  useEffect(()=>{
    const el=ref.current;if(!el||!enabled)return;
    let target=el.scrollTop,raf=0,gliding=false;
    const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const max=()=>el.scrollHeight-el.clientHeight;
    const slides=()=>[...el.querySelectorAll<HTMLElement>('[data-slide]')];
    const step=()=>{
      const gap=target-el.scrollTop;
      if(Math.abs(gap)<0.6){el.scrollTop=target;gliding=false;return}
      el.scrollTop+=gap*0.085;
      raf=requestAnimationFrame(step);
    };
    const glide=(to:number)=>{target=Math.max(0,Math.min(max(),to));if(calm){el.scrollTop=target;return}if(!gliding){gliding=true;raf=requestAnimationFrame(step)}};
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey)return; // pinch zoom
      event.preventDefault();
      const delta=event.deltaMode===1?event.deltaY*32:event.deltaMode===2?event.deltaY*el.clientHeight:event.deltaY;
      glide((gliding?target:el.scrollTop)+delta*0.45);
    };
    const current=()=>{const mid=el.scrollTop+el.clientHeight*0.4;const list=slides();let at=0;list.forEach((s,i)=>{if(s.offsetTop<=mid)at=i});return at};
    const scrolled=()=>{if(!gliding)target=el.scrollTop;onIndex(current())};
    const key=(event:KeyboardEvent)=>{
      if((event.target as Element).closest('input,textarea,select'))return;
      const list=slides(),at=current();
      const go=(i:number)=>{const s=list[Math.max(0,Math.min(list.length-1,i))];if(s){event.preventDefault();glide(s.offsetTop-12)}};
      if(['ArrowDown','PageDown','ArrowRight',' '].includes(event.key))go(at+1);
      else if(['ArrowUp','PageUp','ArrowLeft'].includes(event.key))go(at-1);
      else if(event.key==='Home')go(0);
      else if(event.key==='End')go(list.length-1);
    };
    el.addEventListener('wheel',wheel,{passive:false});el.addEventListener('scroll',scrolled,{passive:true});document.addEventListener('keydown',key);
    const jump=(event:Event)=>{const s=slides()[(event as CustomEvent<number>).detail];if(s)glide(s.offsetTop-12)};
    el.addEventListener('viewer-jump',jump);
    return()=>{cancelAnimationFrame(raf);el.removeEventListener('wheel',wheel);el.removeEventListener('scroll',scrolled);document.removeEventListener('keydown',key);el.removeEventListener('viewer-jump',jump)};
  },[ref,enabled,onIndex]);
}

export default function PresentationLibrary({renderVisual}:{renderVisual:(type:string)=>ReactNode}) {
  const [decks,setDecks]=useState<Presentation[]>([]);
  const [order,setOrder]=useState<Order>('updated');
  const [filters,setFilters]=useState({className:'',unit:'',topic:''});
  const [search,setSearch]=useState('');
  const [focus,setFocusRaw]=useState(0);
  const [slideAt,setSlideAt]=useState(0); // which slide of the front presentation is turned to the front
  const [arrived,setArrived]=useState(false); // the front presentation was just picked from the shelf: it rises in
  const setFocus=(i:number)=>{setFocusRaw(i);setSlideAt(0);setArrived(false)};
  /** Puts a presentation from the shelf in front and goes back up to it. */
  const bringUp=(id:string)=>{const i=ordered.findIndex(d=>d.id===id);if(i<0)return;setFocusRaw(i);setSlideAt(0);setArrived(true);scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})};
  const [viewer,setViewer]=useState<Presentation|null>(null);
  const [viewerIndex,setViewerIndex]=useState(0);
  const [markerId,setMarkerId]=useState('');
  const [info,setInfo]=useState<Presentation|null>(null);
  const [markerDeck,setMarkerDeck]=useState<Presentation|null>(null);
  const [markerIndex,setMarkerIndex]=useState(0);
  const [review,setReview]=useState<Presentation|null>(null);
  const [edit,setEdit]=useState<Presentation|null>(null);
  const [remove,setRemove]=useState<Presentation|null>(null);
  const [menu,setMenu]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [creating,setCreating]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const scroller=useRef<HTMLDivElement>(null);
  const [progress,setProgress]=useState('');
  const editor=(id:string,slide?:number)=>'?deck='+encodeURIComponent(id)+(slide?'&slide='+slide:'');
  useSlowScroll(scroller,!!viewer,setViewerIndex);

  useEffect(()=>{
    async function load(){
      const saved=await listPresentations();
      if(!localStorage.getItem('liveboard-five-slide-examples-v1')){
        for(const lesson of newLessons){if(!saved.some(deck=>deck.id===lesson.id)){await savePresentation(lesson);saved.push(lesson)}}
        localStorage.setItem('liveboard-five-slide-examples-v1','1');
      }
      setDecks(saved);
    }
    load().catch(()=>setError('Could not open your presentations.')).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;if(menu)setMenu('');else if(viewer)setViewer(null);else if(review)setReview(null);else if(creating)setCreating(false);else if(info)setInfo(null);else if(markerDeck)setMarkerDeck(null)};
    const away=(event:PointerEvent)=>{if(menu&&!(event.target as Element).closest('.deck-menu'))setMenu('')};
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',away);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',away)};
  },[menu,viewer,review,creating,info,markerDeck]);

  async function update(run:()=>Promise<void>){
    setBusy(true);setError('');
    try{await run();setDecks(await listPresentations())}
    catch{setError('Could not save the change. Check that this browser allows storage.')}
    finally{setBusy(false)}
  }
  async function importFiles(files:File[]){
    if(!files.length)return;
    setBusy(true);setError('');setProgress('Preparing presentation…');
    try{
      const imported=await importPresentation(files,setProgress);
      setEdit({...imported,id:crypto.randomUUID(),className:'',unit:'',topic:'',updated:Date.now()});
    }catch(error){
      setError(error instanceof Error?error.message:'Unable to import the presentation.');
    }finally{
      setBusy(false);setProgress('');
    }
  }
  function create(){
    setEdit({id:crypto.randomUUID(),title:'',slides:[{...initialSlides[0],title:'Untitled slide',body:'',detail:'',notes:'',visual:'none'}],className:'',unit:'',topic:'',updated:Date.now()});
  }
  function download(name:string,text:string,type:string){
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  const fileName=(title:string)=>title.replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,60)||'presentation';
  /** The class's questions as a plain document a teacher can paste into their planning notes. */
  function questionsFile(deck:Presentation){
    const s=deck.lastSession!;
    const lines=['# Questions from class: '+deck.title,'',new Date(s.at).toLocaleDateString()+' · '+s.total+' question'+(s.total===1?'':'s')+', '+s.open+' left open',''];
    deck.slides.forEach((slide,i)=>{
      const here=s.questions.filter(q=>q.slide===i);if(!here.length)return;
      lines.push('## Slide '+(i+1)+': '+slide.title.replace(/\n/g,' '),'');
      for(const q of here){lines.push('- '+(q.resolved?'[answered] ':'[open] ')+q.body+' ('+q.author+')');for(const r of q.replies)lines.push('  - '+r)}
      lines.push('');
    });
    download(fileName(deck.title)+'-questions.md',lines.join('\n'),'text/markdown');
  }

  const facets=groups.filter(([key])=>decks.some(deck=>deck[key]));
  const words=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ordered=decks.filter(deck=>groups.every(([key])=>!filters[key]||deck[key]===filters[key])&&words.every(word=>[deck.title,deck.className,deck.unit,deck.topic].join(' ').toLowerCase().includes(word))).sort((a,b)=>
    order==='updated'?Math.max(b.opened||0,b.updated||0)-Math.max(a.opened||0,a.updated||0): // most recently opened or edited first: that one is in front
    a[order].localeCompare(b[order],undefined,{numeric:true,sensitivity:'base'})||a.title.localeCompare(b.title));
  const examples=decks.filter(isExample);
  /** Opens a presentation at a slide, and remembers it was the last one opened so it is in front next time. */
  function open(target:Presentation,slide=0){void savePresentation({...target,opened:Date.now()}).catch(()=>{}).finally(()=>go(editor(target.id,slide)))}
  const classes=[...new Set(decks.map(d=>d.className).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const at=Math.max(0,Math.min(ordered.length-1,focus)),deck=ordered[at]; // the presentation in front; its slides are on the tray
  const items:ReelItem[]=deck?deck.slides.map((slide,i)=>({id:deck.id+':'+i,slide,label:`Slide ${i+1}${slide.title?': '+slide.title.replace(/\n/g,' ').slice(0,60):''}`})):[];
  const exampleMarker=viewer?.sampleMarkers?.find(marker=>marker.id===markerId);
  const markerItems=(deck:Presentation)=>deck.lastSession ? deck.lastSession.questions : (deck.sampleMarkers||[]).map(m=>({...m,replies:m.response?[m.response]:[]}));
  const markers=markerDeck?markerItems(markerDeck).map((m,i)=>({...m,sequence:i})).sort((a,b)=>Number(!!a.resolved)-Number(!!b.resolved)||a.slide-b.slide||a.sequence-b.sequence):[];
  const activeMarker=markers[markerIndex];
  const date=(value?:number)=>value?new Date(value).toLocaleString():'Not recorded for this older presentation';
  const peak=review?.lastSession?Math.max(1,...review.lastSession.bySlide):1;

  return <><TopBar role="teacher" here="library"/><main className="deck-library">
    <header className="library-header"><div><h1>Presentations</h1>
      </div>
      <div className="library-header-actions">
        <input ref={fileInput} type="file" accept={importAccept} multiple hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void importFiles(files)}}/>
        <button className="primary" disabled={busy} onClick={()=>setCreating(true)}>New presentation</button>
      </div>
    </header>
    {progress&&<p role="status">{progress}</p>}
    <div className="reel-bar">
      <label className="library-search"><span className="sr-only">Search</span><input type="search" value={search} placeholder="Find a presentation: title, class, unit or topic" onChange={event=>{setSearch(event.target.value);setFocus(0)}}/></label>
      <nav className="recent-names" aria-label="Three newest presentations">{decks.slice().sort((a,b)=>(b.created??b.updated)-(a.created??a.updated)).slice(0,3).map(d=><button key={d.id} title={d.title} onClick={()=>open(d)}>{d.title}</button>)}</nav>
      {classes.length>1&&<div className="reel-classes" role="group" aria-label="Show one class">
        <button aria-pressed={!filters.className} onClick={()=>{setFilters({...filters,className:''});setFocus(0)}}>All</button>
        {classes.map(name=><button key={name} aria-pressed={filters.className===name} style={{'--cc':classColor(name)} as any} onClick={()=>{setFilters({...filters,className:filters.className===name?'':name});setFocus(0)}}><i/>{name}</button>)}
      </div>}
    </div>
    {error&&<p role="alert">{error}</p>}
    {loading?<p>Loading presentations…</p>:!deck?<p className="library-empty reel-empty">{decks.length?'No presentations match.':'Nothing here yet. Import the slides you already teach from, or start a new presentation.'}</p>:<>
      <div key={deck.id} className={'deck-stage'+(arrived?' from-below':'')} style={{'--cc':classColor(deck.className)} as any}>
        <Reel items={items} focus={slideAt} onFocus={setSlideAt} onOpen={index=>open(deck,index)} renderVisual={renderVisual} color={classColor(deck.className)} label={deck.title}/>
        <section className="reel-hub" aria-live="polite">
          <p className="reel-meta"><i/>{[deck.className,deck.unit,deck.topic].filter(Boolean).join(' · ')||'No class set'}{isExample(deck)?' · Example':''}</p>
          <h2>{deck.title}</h2>
          <div className="deck-actions">
            <a className="deck-open primary" {...link(editor(deck.id,slideAt))} onClick={event=>{event.preventDefault();open(deck,slideAt)}}>Open<small>{slideAt?`at slide ${slideAt+1}`:`${deck.slides.length} slide${deck.slides.length===1?'':'s'}`}</small></a>
            <button onClick={()=>{setMarkerDeck(deck);setMarkerIndex(0)}}>Markers · {markerItems(deck).length}</button>
            <span className="deck-menu"><button aria-label={'More for '+deck.title} aria-haspopup="menu" aria-expanded={menu===deck.id} onClick={()=>setMenu(menu===deck.id?'':deck.id)}>•••</button>
          {menu===deck.id&&<span className="deck-menu-list" role="menu">
            <button role="menuitem" onClick={()=>{setMenu('');setInfo(deck)}}>Presentation info</button>
            <button role="menuitem" onClick={()=>{setMenu('');setEdit(deck)}}>Title and class…</button>
            <button role="menuitem" disabled={busy} onClick={()=>{setMenu('');void update(async()=>{await savePresentation({...deck,id:crypto.randomUUID(),title:deck.title+' (copy)',updated:Date.now(),lastSession:undefined});setFilters({className:'',unit:'',topic:''})})}}>Duplicate</button>
            <button role="menuitem" onClick={()=>{setMenu('');download(fileName(deck.title)+'.liveboard.json',JSON.stringify({title:deck.title,slides:deck.slides},null,2),'application/json')}}>Save as a file</button>
            <button role="menuitem" className="deck-delete" onClick={()=>{setMenu('');setRemove(deck)}}>Delete…</button>
          </span>}</span>
          </div>
          {deck.lastSession&&<button className="deck-session" onClick={()=>setReview(deck)}><b>{deck.lastSession.total}</b> question{deck.lastSession.total===1?'':'s'} from class{deck.lastSession.open?<> · <em>{deck.lastSession.open} open</em></>:' · all answered'}<small>{ago(deck.lastSession.at)} · Review class →</small></button>}
        </section>
        <ReelStrip items={items} focus={slideAt} onFocus={setSlideAt} color={classColor(deck.className)}/>
      </div>
      {ordered.length>1&&<section className="deck-shelf" aria-labelledby="shelfTitle">
        <header><h2 id="shelfTitle">All presentations</h2><span>{ordered.length}</span><small>Pick one to bring it up front · double-click to open</small></header>
        <ul>{ordered.map(other=><li key={other.id}><button className={'shelf-card'+(other.id===deck.id?' current':'')} style={{'--cc':classColor(other.className)} as any} aria-current={other.id===deck.id?'true':undefined} onClick={()=>bringUp(other.id)} onDoubleClick={()=>open(other)} title={other.id===deck.id?'In front now · double-click to open':'Bring up front · double-click to open'}>
          <span className="shelf-thumb">{other.slides[0]&&<SlideThumb slide={other.slides[0]} renderVisual={renderVisual}/>}{!!other.lastSession?.open&&<em>{other.lastSession.open} open</em>}</span>
          <span className="shelf-text"><b>{other.title}</b><small><i/>{other.className||'No class'}</small><small>{other.slides.length+' slide'+(other.slides.length===1?'':'s')} · {ago(Math.max(other.opened||0,other.updated||0))}</small></span>
        </button></li>)}</ul>
      </section>}
    </>}
    {examples.length>0&&decks.length>examples.length&&<p className="library-examples">The {examples.length} example{examples.length===1?'':'s'} can go once you have your own. <button disabled={busy} onClick={()=>update(async()=>{for(const deck of examples)await deletePresentation(deck.id)})}>Remove examples</button></p>}

    {info&&<div className="modal-backdrop" onClick={()=>setInfo(null)}><section className="modal" role="dialog" aria-modal="true" aria-label="Presentation info" onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close information" onClick={()=>setInfo(null)}>×</button><span className="eyebrow">PRESENTATION INFO</span><h2>{info.title}</h2><dl className="presentation-info"><dt>Created</dt><dd>{date(info.created)}</dd><dt>Last edited</dt><dd>{date(info.updated)}</dd><dt>Slides</dt><dd>{info.slides.length}</dd><dt>Markers</dt><dd>{markerItems(info).length}</dd>{groups.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{info[key]||'Not set'}</dd></div>)}<dt>Last live class</dt><dd>{info.lastSession?date(info.lastSession.at):'Not taught live yet'}</dd></dl></section></div>}
    {markerDeck&&<div className="modal-backdrop" onClick={()=>setMarkerDeck(null)}><section className="modal marker-browser" role="dialog" aria-modal="true" aria-label="Presentation markers" onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close markers" onClick={()=>setMarkerDeck(null)}>×</button><span className="eyebrow">PRESENTATION MARKERS</span><h2>{markerDeck.title}</h2><p className="quiet">Open markers first, then resolved · ordered by slide</p>{markers.length?<div className="library-marker-layout"><div className="library-marker-list">{markers.map((marker,i)=><div key={i}>{(i===0||!!markers[i-1].resolved!==!!marker.resolved)&&<h3>{marker.resolved?'Resolved markers':'Open markers'}</h3>}<button className={'marker-card '+(markerIndex===i?'selected':'')} style={{'--tc':'var(--student-marker)'} as any} onClick={()=>setMarkerIndex(i)}><div><span className="intent-dot">{marker.kind==='question'?'?':marker.kind==='explain'?'↗':'✧'}</span><b>{marker.kind==='question'?'Question':marker.kind==='explain'?'Explain again':'Idea'}</b><span className="card-chevron">↗</span></div><p>{marker.body}</p><footer>{marker.author}<i> · </i>Slide {marker.slide+1}{!!marker.resolved&&' · Resolved'}</footer></button></div>)}</div>{activeMarker&&<article className="marker-browser-detail"><span className="eyebrow">SLIDE {activeMarker.slide+1} · {activeMarker.resolved?'RESOLVED':'OPEN'}</span><h3>{activeMarker.kind==='question'?'Question':activeMarker.kind==='explain'?'Explain again':'Idea'}</h3><p>{activeMarker.body}</p><small>{activeMarker.author}</small>{activeMarker.replies.map((reply,i)=><blockquote key={i}>{reply}</blockquote>)}{!activeMarker.replies.length&&<p className="quiet">No replies yet.</p>}<a className="outline" {...link(editor(markerDeck.id,activeMarker.slide))}>Open this slide</a><nav className="marker-browser-nav" aria-label="Browse markers"><button className="outline" disabled={!markerIndex} onClick={()=>setMarkerIndex(i=>i-1)}>← Previous</button><span>{markerIndex+1} / {markers.length}</span><button className="outline" disabled={markerIndex===markers.length-1} onClick={()=>setMarkerIndex(i=>i+1)}>Next →</button></nav></article>}</div>:<p>No saved markers yet.</p>}</section></div>}

    {creating&&<div className="modal-backdrop" onClick={()=>setCreating(false)}><section className="modal creation-picker" role="dialog" aria-modal="true" aria-label="New presentation" onClick={event=>event.stopPropagation()}>
      <button className="modal-close" aria-label="Close new presentation" onClick={()=>setCreating(false)}>×</button>
      <h2>New presentation</h2>
      <button className="creation-option" onClick={()=>{setCreating(false);create()}}><b>✦ Start from scratch</b><span>Start with a blank slide.</span></button>
      <button className="creation-option" onClick={()=>{setCreating(false);fileInput.current?.click()}}><b>↑ Import slides</b><span>Bring a PDF, images, or a LiveBoard file.</span></button>
      <p className="fineprint">Using PowerPoint or Google Slides? Export as a PDF first.</p>
    </section></div>}

    {viewer&&<div className="modal-backdrop" onClick={()=>setViewer(null)}><section className="modal slides-viewer" role="dialog" aria-modal="true" aria-label={'Slides of '+viewer.title} onClick={event=>event.stopPropagation()}>
      <header className="viewer-head"><div><span className="eyebrow">{[viewer.className,viewer.unit,viewer.topic].filter(Boolean).join(' / ')||'PRESENTATION'}</span><h2>{viewer.title}</h2></div>
        <span className="viewer-count">{viewerIndex+1} / {viewer.slides.length}</span>
        <a className="primary" {...link(editor(viewer.id,viewerIndex))}>Open at slide {viewerIndex+1}</a>
        <button className="modal-close" aria-label="Close slides" onClick={()=>setViewer(null)}>×</button></header>
      <div className="viewer-body">
        <nav className="viewer-rail" aria-label="Jump to a slide">{viewer.slides.map((_,i)=><button key={i} aria-current={i===viewerIndex} aria-label={'Slide '+(i+1)} onClick={()=>scroller.current?.dispatchEvent(new CustomEvent('viewer-jump',{detail:i}))}>{i+1}{viewer.lastSession?.bySlide[i]?<i title={viewer.lastSession.bySlide[i]+' questions from class'}/>:null}</button>)}</nav>
        <div className="viewer-scroll" ref={scroller} tabIndex={0}>
          {viewer.slides.map((slide,i)=><article key={i} data-slide={i} className={i===viewerIndex?'on':''}>
            <div className="slide-canvas"><SlideFace slide={slide} number={i} footer={[viewer.className,viewer.topic].filter(Boolean).join(' / ').toUpperCase()||'LIVEBOARD'} renderVisual={renderVisual}>
              {viewer.sampleMarkers?.filter(marker=>marker.slide===i).map(marker=><button key={marker.id} className="example-pin" aria-label="Open example student marker" aria-pressed={markerId===marker.id} onClick={()=>setMarkerId(markerId===marker.id?'':marker.id)}>?</button>)}
            </SlideFace></div>
            {exampleMarker&&exampleMarker.slide===i&&<section className="sample-marker-thread"><strong>Example student marker</strong><p>{exampleMarker.body}</p><strong>Teacher follow-up</strong><p>{exampleMarker.response}</p></section>}
            {slide.notes&&<p className="viewer-notes"><b>Your notes</b>{slide.notes}</p>}
          </article>)}
          <p className="viewer-end">End of the deck. <a {...link(editor(viewer.id))}>Open it to edit or teach →</a></p>
        </div>
      </div>
    </section></div>}

    {review?.lastSession&&<div className="modal-backdrop" onClick={()=>setReview(null)}><section className="modal class-review" role="dialog" aria-modal="true" aria-label={'Questions from class for '+review.title} onClick={event=>event.stopPropagation()}>
      <button className="modal-close" aria-label="Close review" onClick={()=>setReview(null)}>×</button>
      <span className="eyebrow">AFTER CLASS · {ago(review.lastSession.at).toUpperCase()}</span><h2>{review.title}</h2>
      <p className="review-sum"><b>{review.lastSession.total}</b> question{review.lastSession.total===1?'':'s'} · <b>{review.lastSession.open}</b> left open · room {review.lastSession.room}</p>
      <div className="review-bars" role="img" aria-label="Questions per slide">{review.slides.map((slide,i)=><div key={i} title={'Slide '+(i+1)+': '+(review.lastSession!.bySlide[i]||0)+' questions'}><i style={{height:Math.round(100*(review.lastSession!.bySlide[i]||0)/peak)+'%'}}/><span>{i+1}</span></div>)}</div>
      <div className="review-list">{review.lastSession.total===0?<p className="library-empty">No one placed a marker in this class.</p>:review.slides.map((slide,i)=>{const here=review.lastSession!.questions.filter(q=>q.slide===i);return here.length?<section key={i}><h3><a {...link(editor(review.id,i))}>Slide {i+1} · {slide.title.replace(/\n/g,' ')}</a><span>{here.length}</span></h3>
        {here.map((q,n)=><div className={'review-q'+(q.resolved?' done':'')} key={n}><p>{q.body}</p><small>{q.author} · {q.resolved?'answered':'still open'}</small>{q.replies.map((r,k)=><blockquote key={k}>{r}</blockquote>)}</div>)}</section>:null})}</div>
      <div className="preview-controls"><a className="primary" {...link(editor(review.id))}>Open presentation</a><button className="outline" disabled={!review.lastSession.total} onClick={()=>questionsFile(review)}>Save the questions</button></div>
    </section></div>}

    {edit&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Presentation details"><button className="modal-close" aria-label="Close details" onClick={()=>setEdit(null)}>×</button><h2>Title and class</h2>
      <form onSubmit={event=>{event.preventDefault();const isNew=!decks.some(deck=>deck.id===edit.id);void update(async()=>{await savePresentation({...edit,title:edit.title.trim(),updated:Date.now()});setEdit(null);if(isNew)go(editor(edit.id))})}}>
        <label>Title<input required value={edit.title} maxLength={30} onChange={event=>setEdit({...edit,title:event.target.value})}/><small>{edit.title.length}/30</small></label>
        {groups.map(([key,label])=><label key={key}>{label}<input value={edit[key]} maxLength={30} placeholder={key==='className'?'e.g. AP Chemistry, period 3':key==='unit'?'e.g. Unit 7':'e.g. Equilibrium'} onChange={event=>setEdit({...edit,[key]:event.target.value})}/><small>{edit[key].length}/30</small></label>)}
        <button className="primary full" disabled={busy||!edit.title.trim()}>Save presentation</button>
      </form>
    </section></div>}
    {remove&&<div className="modal-backdrop"><section className="modal" role="alertdialog" aria-modal="true" aria-label="Delete presentation"><h2>Delete {remove.title}?</h2><p>This removes the presentation{remove.lastSession?' and the questions kept from its last class':''} from this browser.</p><button className="outline" onClick={()=>setRemove(null)}>Cancel</button> <button className="primary" disabled={busy} onClick={()=>update(async()=>{await deletePresentation(remove.id);setRemove(null)})}>Delete presentation</button></section></div>}
  </main></>;
}
