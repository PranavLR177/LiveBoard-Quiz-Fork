'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { SlideFace } from './SlideFace';
import { EditHistory } from './editHistory';
import { objectSlide } from './objectLayout';
import SlideEditor,{ SlideElements,syncElements } from './SlideEditor';
import PresentationLibrary from './PresentationLibrary';
import { getPresentation,savePresentation,type Presentation,type Session } from './presentations';
import WaitingRoom from './WaitingRoom';
import { initialSlides, sampleMarkers, type Slide } from './data';
type Region = { left:number; top:number; width:number; height:number };
type Spot = { x:number; y:number; slide:number; region?:Region; screenshot?:string };
type Mark={region?:Region; screenshot?:string;id:string;slide:number;x:number;y:number;kind:string;author:string;body:string;resolved:number;created:number};
type Reply={id:string;marker:string;author:string;body:string;image?:string;source?:string};
const kinds:any={question:{label:'Question',verb:'Ask a question',icon:'?',color:'var(--t-question)'},explain:{label:'Explain again',verb:'Explain this again',icon:'↗',color:'var(--t-explain)'},idea:{label:'Idea',verb:'Explore an idea',icon:'✧',color:'var(--t-link)'}};
function Visual({type}:{type:string}){if(type==='none')return null;if(type==='graph')return <svg viewBox="0 0 500 270" className="chart" aria-label="Two concentrations become constant at different levels"><path d="M40 20V230H480" fill="none" stroke="#b9b1cc" strokeWidth="2"/><path d="M40 35 C120 35 120 170 285 170H470" fill="none" stroke="#9873d8" strokeWidth="4"/><path d="M40 210 C120 210 120 100 285 100H470" fill="none" stroke="#dca64c" strokeWidth="4"/><path d="M285 25V230" stroke="#b9b1cc" strokeDasharray="6 6"/><text x="300" y="45">Equilibrium</text><text x="390" y="88">Product</text><text x="390" y="193">Reactant</text><text x="380" y="260">Time →</text></svg>;
 if(type==='bottle')return <div className="bottle-visual"><div className="bottle"><i/><div className="water">{Array.from({length:12},(_,i)=><span key={i} style={{left:(15+i*23%70)+'%',bottom:(12+i*37%75)+'%',width:5+i%4*3,height:5+i%4*3}}/>)}</div></div><div className="bottle-copy"><span className="eyebrow">A FAMILIAR EQUILIBRIUM</span><h3>CO₂(g) ⇌ CO₂(aq)</h3><p>Same particles.<br/>A different balance.</p></div></div>;
 if(type==='questions'||type==='exit')return <div className="question-visual">{Object.entries(kinds).map(([key,k]:any)=><div key={key}><span style={{color:k.color,borderColor:k.color}}>{k.icon}</span><h4>{k.verb}</h4><p>{key==='question'?'“What happens if…?”':key==='explain'?'“Can we revisit…?”':'“Could we try…?”'}</p></div>)}</div>;
 return <div className="reaction-visual"><div className="molecule-cloud purple">{[0,1,2,3,4,5].map(i=><i key={i} style={{left:[18,55,34,72,20,60][i]+'%',top:[20,12,48,40,75,75][i]+'%'}}/>)}<span>Reactants</span></div><div className="reaction-arrows"><span className="arrow forward">⟶</span><span className="arrow back">⟵</span><small>{type==='shift'?'a new balance':'equal rates'}</small></div><div className="molecule-cloud gold">{[0,1,2,3].map(i=><i key={i} style={{left:[25,60,25,60][i]+'%',top:[20,28,66,72][i]+'%'}}/>)}<span>Products</span></div></div>}
export default function Page(){
 const [slides,setSlides]=useState<Slide[]>(initialSlides),[title,setTitle]=useState('The quiet motion of equilibrium'),[index,setIndex]=useState(1),[role,setRole]=useState('teacher'),[markers,setMarkers]=useState<Mark[]>(sampleMarkers),[replies,setReplies]=useState<Reply[]>([]),[selected,setSelected]=useState<string|null>(null),[placing,setPlacing]=useState(false),[spot,setSpot]=useState<Spot|null>(null),[kind,setKind]=useState('question'),[body,setBody]=useState(''),[reply,setReply]=useState(''),[tab,setTab]=useState('conversation'),[filter,setFilter]=useState('all'),[scope,setScope]=useState('slide'),[until,setUntil]=useState(0),[now,setNow]=useState(Date.now()),[duration,setDuration]=useState(0),[modal,setModal]=useState(''),[room,setRoom]=useState(''),[secret,setSecret]=useState(''),[joinCode,setJoinCode]=useState(''),[name,setName]=useState(''),[follow,setFollow]=useState(true),[liveIndex,setLiveIndex]=useState(0),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[edit,setEdit]=useState<Slide|null>(null),[focus,setFocus]=useState(false);
 const [editing,setEditing]=useState(false),[selectedElement,setSelectedElement]=useState(''),[reviewing,setReviewing]=useState(false);
 const [library,setLibrary]=useState(false);
 const [markerSearch,setMarkerSearch]=useState(''),[markerOrder,setMarkerOrder]=useState('newest'),[highlighted,setHighlighted]=useState<number|null>(null),[dragged,setDragged]=useState<number|null>(null);
 const dragSlide=useRef<number|null>(null);
 const [durationOpen,setDurationOpen]=useState(false);
 const [showResolved,setShowResolved]=useState(false);
 const [showStudentMarkers,setShowStudentMarkers]=useState(true);
 const [previewLive,setPreviewLive]=useState(false);
 useEffect(()=>{const outside=(e:Event)=>{const target=e.target as Element;if(!target.closest('.thumbnail,.slide-edit-actions'))setHighlighted(null);if(!target.closest('.discussion-duration'))setDurationOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[]);
 const [deck,setDeck]=useState<Presentation|null>(null);
 const [ready,setReady]=useState(false);
 const historyRef=useRef<EditHistory|null>(null),historyDeck=useRef('');
 const [historyVersion,setHistoryVersion]=useState(0),[cropId,setCropId]=useState('');
 void historyVersion;
 useEffect(()=>{if(!deck)return;if(historyDeck.current!==deck.id){historyDeck.current=deck.id;historyRef.current=new EditHistory(slides);setHistoryVersion(v=>v+1)}},[deck?.id]);
 function changeSlide(next:Slide){const all=slides.map((v,i)=>i===index?next:v);if(!historyRef.current)historyRef.current=new EditHistory(slides);historyRef.current.record(all);setHistoryVersion(v=>v+1);setSlides(all);if(deck)void savePresentation({...deck,slides:all,updated:Date.now()}).catch(()=>setNotice('Could not save this slide.'))}
 function undoEdit(){const next=historyRef.current?.undo();if(next){setSlides(next);if(deck)void savePresentation({...deck,slides:next,updated:Date.now()}).catch(()=>setNotice('Could not save this slide.'));setHistoryVersion(v=>v+1);setSelectedElement('');setCropId('')}}
 function redoEdit(){const next=historyRef.current?.redo();if(next){setSlides(next);if(deck)void savePresentation({...deck,slides:next,updated:Date.now()}).catch(()=>setNotice('Could not save this slide.'));setHistoryVersion(v=>v+1);setSelectedElement('');setCropId('')}}
 const participantRef=useRef('');
 const credentialsRef=useRef({role,secret});credentialsRef.current={role,secret};
 const appRef = useRef<HTMLDivElement>(null);
 const slideRef = useRef<HTMLDivElement>(null);
 const origin = useRef<{x:number;y:number}|null>(null);
 const [selection,setSelection] = useState<Region|null>(null);
 const [capturing,setCapturing] = useState(false);
 const captureVersion = useRef(0);

 useEffect(() => {
   const update = () => setFocus(document.fullscreenElement === appRef.current);
   document.addEventListener('fullscreenchange', update);
   return () => document.removeEventListener('fullscreenchange', update);
 }, []);

 async function toggleFullscreen() {
   if (document.fullscreenElement) {
     await document.exitFullscreen();
     return;
   }
   if (focus) { setFocus(false); return; }
   try {
     if (!appRef.current?.requestFullscreen) throw new Error();
     await appRef.current.requestFullscreen();
   } catch {
     setFocus(true);
     setNotice('Browser fullscreen is unavailable. Expanded view is on.');
   }
 }

 function pointerPosition(event:PointerEvent<HTMLDivElement>) {
   const bounds = event.currentTarget.getBoundingClientRect();
   const percent = (value:number) => Math.max(0, Math.min(100,value));
   return {x:percent(100*(event.clientX-bounds.left)/bounds.width),y:percent(100*(event.clientY-bounds.top)/bounds.height)};
 }

 function regionBetween(start:{x:number;y:number}, end:{x:number;y:number}):Region {
   return {left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};
 }

 function cancelPlacement() {
   origin.current=null;
   setSelection(null);
   setPlacing(false);
 }

 async function finishPlacement(event:PointerEvent<HTMLDivElement>) {
   if (!origin.current) return;
   const point = pointerPosition(event);
   const region = regionBetween(origin.current, point);
   const bounds = event.currentTarget.getBoundingClientRect();
   const isRegion = region.width*bounds.width/100 >= 8 && region.height*bounds.height/100 >= 8;
   cancelPlacement();
   setSelected(null);
   const draft:Spot = isRegion
     ? {x:region.left+region.width/2,y:region.top+region.height/2,slide:index,region}
     : {...point,slide:index};
   setEditing(false);setSelected(null);setSpot(draft);
   if (!isRegion || !slideRef.current) return;
   const version = ++captureVersion.current;
   setCapturing(true);
   try {
     const {toCanvas} = await import('html-to-image');
     const source = await toCanvas(slideRef.current,{pixelRatio:1,skipFonts:true});
     const width = source.width*region.width/100;
     const height = source.height*region.height/100;
     const scale = Math.min(1,640/Math.max(width,height));
     const cropped = document.createElement('canvas');
     cropped.width = Math.max(1,Math.round(width*scale));
     cropped.height = Math.max(1,Math.round(height*scale));
     const context = cropped.getContext('2d');
     if (!context) throw new Error();
     context.drawImage(source,source.width*region.left/100,source.height*region.top/100,width,height,0,0,cropped.width,cropped.height);
     const screenshot = cropped.toDataURL('image/jpeg',0.78);
     if (screenshot.length > 250000) throw new Error();
     if (version === captureVersion.current) setSpot(current => current === draft ? {...draft,screenshot} : current);
   } catch {
     if (version === captureVersion.current) setNotice('The selected region is saved. Its screenshot preview could not be created.');
   } finally {
     if (version === captureVersion.current) setCapturing(false);
   }
 }

 function regionStyle(region:Region) {
   return {left:region.left+'%',top:region.top+'%',width:region.width+'%',height:region.height+'%'};
 }

 const stateRef=useRef({follow,role});stateRef.current={follow,role};const active=markers.find(m=>m.id===selected);const open=until>now;const seconds=Math.max(0,Math.ceil((until-now)/1000));const slide=slides[index]||slides[0];
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);const params=new URLSearchParams(location.search);const participant=localStorage.getItem('liveboard-participant')||crypto.randomUUID();localStorage.setItem('liveboard-participant',participant);participantRef.current=participant;
 const code=params.get('room');const view=params.get('view');
 const theme=params.get('theme');
 if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;
 if(view==='library')setLibrary(true);
 const deckId=params.get('deck');
 if(deckId&&!code&&view!=='library'){
   getPresentation(deckId).then(saved=>{
     if(!saved){setLibrary(true);return}
     setDeck(saved);setTitle(saved.title);setSlides(saved.slides.map(objectSlide));setIndex(Math.max(0,Math.min(saved.slides.length-1,Number(params.get('slide'))||0)));setMarkers(saved.sampleMarkers||[]);setReplies((saved.sampleMarkers||[]).map(marker=>({id:marker.id+'-reply',marker:marker.id,author:'Teacher follow-up',body:marker.response})));
   }).catch(()=>setNotice('Could not open this presentation.')).finally(()=>setReady(true));
 }else setReady(true);
 if(view==='projector'&&code){setRole('projector');credentialsRef.current={role:'projector',secret:''};setRoom(code.toUpperCase());loadRoom(code.toUpperCase()).catch(e=>setNotice(e.message))}
 else if(code||view==='student'){setRole('student');setJoinCode(code||'')}else{const r=localStorage.getItem('marker-slides-host');if(r){try{const v=JSON.parse(r);setJoinCode(v.id)}catch{}}}return()=>clearInterval(t)},[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5500);return()=>clearTimeout(t)},[notice]);
 async function loadRoom(id:string){const r=await fetch('/api/rooms?id='+encodeURIComponent(id)+(credentialsRef.current.role==='projector'?'&view=projector':''),{headers:{'x-participant':participantRef.current,...(credentialsRef.current.role==='teacher'&&credentialsRef.current.secret?{Authorization:'Bearer '+credentialsRef.current.secret}:{})}});const d:any=await r.json();if(!r.ok)throw Error(d.error);setSlides(d.slides.map(objectSlide));setShowStudentMarkers(d.studentMarkers!==0);setTitle(d.title);setMarkers(d.markers);setReplies(d.replies);setUntil(d.until);setLiveIndex(d.current);if(stateRef.current.follow||stateRef.current.role==='teacher'||stateRef.current.role==='projector')setIndex(d.current);return d;}
 useEffect(()=>{if(!room)return;let stopped=false;const t=setInterval(()=>{if(!stopped)loadRoom(room).catch(()=>setNotice('Connection interrupted. Retrying…'))},2500);return()=>{stopped=true;clearInterval(t)}},[room]);
 function arrangeSlides(order:number[],focus:number){
   if(room||role!=='teacher')return;
   const next=order.map(i=>({...slides[i]}));
   const nextMarkers:Mark[]=[],nextReplies:Reply[]=[];
   order.forEach((oldSlide,newSlide)=>{
     const duplicate=order.indexOf(oldSlide)!==newSlide;
     for(const marker of markers.filter(m=>m.slide===oldSlide)){
       const id=duplicate?crypto.randomUUID():marker.id;
       nextMarkers.push({...marker,id,slide:newSlide});
       nextReplies.push(...replies.filter(r=>r.marker===marker.id).map(r=>({...r,id:duplicate?crypto.randomUUID():r.id,marker:id})));
     }
   });
   setSlides(next);setIndex(focus);setHighlighted(focus);setMarkers(nextMarkers);setReplies(nextReplies);setSelected(null);cancelPlacement();
   if(deck){
     const updated={...deck,slides:next,updated:Date.now(),sampleMarkers:nextMarkers.map(m=>({...m,kind:m.kind as 'question'|'explain'|'idea',response:nextReplies.filter(r=>r.marker===m.id).map(r=>r.body).join('\n\n')})),lastSession:deck.lastSession?{...deck.lastSession,questions:order.flatMap((oldSlide,newSlide)=>deck.lastSession!.questions.filter(q=>q.slide===oldSlide).map(q=>({...q,slide:newSlide}))),bySlide:order.map(i=>deck.lastSession!.bySlide[i]||0)}:undefined};
     setDeck(updated);void savePresentation(updated).catch(()=>setNotice('Could not save slide changes.'));
   }
 }
 function moveSlide(from:number,to:number){if(from===to||to<0||to>=slides.length)return;const order=slides.map((_,i)=>i);order.splice(to,0,order.splice(from,1)[0]);arrangeSlides(order,to)}
 function deleteSlide(at:number){if(slides.length===1){setNotice('Keep at least one slide in your presentation.');return}arrangeSlides(slides.map((_,i)=>i).filter(i=>i!==at),Math.min(at,slides.length-2))}
 function duplicateSlide(at:number){if(slides.length>=40){setNotice('A presentation can have up to 40 slides.');return}const order=slides.map((_,i)=>i);order.splice(at+1,0,at);arrangeSlides(order,at+1)}
 const copiedSlide=useRef<{slide:Slide;markers:Mark[];replies:Reply[]}|null>(null);
 function copySlide(){if(highlighted===null)return;copiedSlide.current=structuredClone({slide:slides[highlighted],markers:markers.filter(m=>m.slide===highlighted),replies:replies.filter(r=>markers.some(m=>m.slide===highlighted&&m.id===r.marker))});setNotice('Slide copied. Paste to insert before the current slide.')}
 function pasteSlide(){
   if(!copiedSlide.current||room||role!=='teacher'||slides.length>=40)return;
   const copy=structuredClone(copiedSlide.current),at=index;
   const next=[...slides.slice(0,at),copy.slide,...slides.slice(at)];
   const newReplies:Reply[]=[];
   const additions=copy.markers.map(m=>{const id=crypto.randomUUID();newReplies.push(...copy.replies.filter(r=>r.marker===m.id).map(r=>({...r,id:crypto.randomUUID(),marker:id})));return {...m,id,slide:at}});
   const nextMarkers=[...markers.map(m=>({...m,slide:m.slide>=at?m.slide+1:m.slide})),...additions];
   const nextReplies=[...replies,...newReplies];
   setSlides(next);setMarkers(nextMarkers);setReplies(nextReplies);setIndex(at);setHighlighted(at);setSelected(null);
   if(deck){const updated={...deck,slides:next,updated:Date.now(),sampleMarkers:nextMarkers.map(m=>({...m,kind:m.kind as 'question'|'explain'|'idea',response:nextReplies.filter(r=>r.marker===m.id).map(r=>r.body).join('\n\n')})),lastSession:deck.lastSession?{...deck.lastSession,questions:deck.lastSession.questions.map(q=>({...q,slide:q.slide>=at?q.slide+1:q.slide})),bySlide:[...deck.lastSession.bySlide.slice(0,at),0,...deck.lastSession.bySlide.slice(at)]}:undefined};setDeck(updated);void savePresentation(updated).catch(()=>setNotice('Could not save the pasted slide.'))}
 }
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.target as Element).closest('input,textarea,[contenteditable]')||room||role!=='teacher'||!(e.ctrlKey||e.metaKey))return;if(e.key.toLowerCase()==='c'&&highlighted!==null){e.preventDefault();copySlide()}if(e.key.toLowerCase()==='v'&&copiedSlide.current){e.preventDefault();pasteSlide()}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[highlighted,slides,markers,replies,index,deck,room,role]);
 async function api(data:any){const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json','x-participant':participantRef.current,...(secret&&role==='teacher'?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify({...data,room})});const d:any=await r.json();if(!r.ok)throw Error(d.error);return d;}
 async function action(fn:()=>Promise<void>){setBusy(true);try{await fn()}catch(e:any){setNotice(e.message||'Something went wrong. Please try again.')}finally{setBusy(false)}}
 async function navigate(i:number){if(i<0||i>=slides.length)return;setIndex(i);setSelected(null);setSpot(null);if(role==='student')setFollow(false);if(room&&role==='teacher')await action(async()=>{await api({action:'control',current:i});setLiveIndex(i)});}
 async function extendDiscussion(){await action(async()=>{const remaining=Math.max(0,Math.ceil((until-Date.now())/1000));if(room){await api({action:'control',duration:remaining+30});await loadRoom(room)}else setUntil(value=>Math.max(value,Date.now())+30000)})}
 async function questionTime(){if(!open&&duration===0){setDurationOpen(true);setNotice('Choose a discussion length greater than zero.');return}await action(async()=>{if(room){await api({action:'control',duration:open?0:duration});await loadRoom(room)}else setUntil(open?0:Date.now()+duration*1000);setNow(Date.now());setDurationOpen(false)})}
 useEffect(()=>{
   if(!deck||room)return;
   if(title===deck.title&&slides===deck.slides)return;
   const timer=setTimeout(()=>{
     savePresentation({...deck,title,slides,updated:Date.now()}).catch(()=>setNotice('Could not save this presentation.'));
   },200);
   return()=>clearTimeout(timer);
 },[deck,title,slides,room]);
 /* While a class is live, keep what students have asked with the deck (text only), so the library can show where the
    class got stuck after the room is gone. Written when the picture changes, not on every poll. */
 const sessionKey=useRef('');
 useEffect(()=>{
   if(!room||role!=='teacher'||!deck)return;
   const asked=markers.filter(m=>m.author!=='Teacher');
   const session:Session={room,at:Date.now(),total:asked.length,open:asked.filter(m=>!m.resolved).length,bySlide:slides.map((_,i)=>asked.filter(m=>m.slide===i).length),
     questions:asked.slice(0,300).map(m=>({slide:m.slide,x:m.x,y:m.y,kind:m.kind,author:m.author,body:m.body,resolved:m.resolved?1:0,replies:replies.filter(r=>r.marker===m.id).map(r=>r.author+': '+r.body).slice(0,10)}))};
   const key=JSON.stringify([session.room,session.questions]);
   if(key===sessionKey.current)return;
   sessionKey.current=key;
   const next={...deck,lastSession:session};
   savePresentation(next).then(()=>setDeck(next)).catch(()=>{});
 },[room,role,deck,markers,replies,slides]);
 function toLibrary(){void action(async()=>{if(!room&&(deck||slides!==initialSlides))await saveDeck();location.assign(location.pathname+'?view=library&theme='+(document.documentElement.dataset.theme||'dark'))})}
 /** A student's own questions and the teacher's answers as a Markdown file. LiveBoard's Import lecture opens it as a note. */
 function keepQuestions(){
   const mine=markers.filter(m=>m.author!=='Teacher');
   const lines=['# '+title,'','Questions I asked in class, with my teacher’s answers.',''];
   slides.forEach((s,i)=>{const here=mine.filter(m=>m.slide===i);if(!here.length)return;lines.push('## '+s.title.replace(/\n/g,' '),'',s.body,'');for(const m of here){lines.push('**'+m.body+'**','');for(const r of replies.filter(r=>r.marker===m.id))lines.push((r.author==='Teacher'?'Teacher: ':'Me: ')+r.body,'');}});
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown'}));a.download=(title.replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,50)||'class')+'-my-questions.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
   setNotice('Saved. In LiveBoard, choose Import lecture and pick this file to study from it.');
 }
 async function saveDeck(){
   const saved={id:deck?.id||crypto.randomUUID(),className:deck?.className||'',unit:deck?.unit||'',topic:deck?.topic||'',sampleMarkers:deck?.sampleMarkers,lastSession:deck?.lastSession,title,slides,updated:Date.now()};
   await savePresentation(saved);
   setDeck(saved);
   return saved;
 }
 async function start(){await action(async()=>{const saved=await saveDeck();const liveSlides=await Promise.all(slides.map(async slide=>{if(!slide.image?.startsWith('data:image/svg+xml'))return slide;const image=new Image();image.src=slide.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||1000;canvas.height=image.naturalHeight||600;canvas.getContext('2d')!.drawImage(image,0,0);return {...slide,image:canvas.toDataURL('image/png')}}));const d=await api({action:'create',title,slides:liveSlides,studentMarkers:showStudentMarkers});setSecret(d.secret);credentialsRef.current={role:'teacher',secret:d.secret};setRoom(d.id);localStorage.setItem('marker-slides-host',JSON.stringify({...d,presentationId:saved.id}));setRole('teacher');setFollow(true);setIndex(0);setSelected(null);await loadRoom(d.id);setModal('share');setNotice('Your live room is ready. Share its code with your class.');})}
 async function join(){await action(async()=>{const code=joinCode.trim().toUpperCase();
 let savedHost:any=null;try{savedHost=JSON.parse(localStorage.getItem('marker-slides-host')||'null')}catch{}
 credentialsRef.current=modal==='resume'&&savedHost?.id===code?{role:'teacher',secret:savedHost.secret}:{role:'student',secret:''};
 const d=await loadRoom(code);setRoom(d.id);let host:any=null;try{host=JSON.parse(localStorage.getItem('marker-slides-host')||'null')}catch{};if(modal==='resume'&&host?.id===code){setSecret(host.secret);setRole('teacher')}else{setSecret('');setRole('student')}setIndex(d.current);setFollow(true);setSelected(null);setModal('');})}
 async function createMarker(){if(role==='student'&&!showStudentMarkers){setNotice('Your teacher has paused student markers.');return}if(!body.trim()||!spot)return;await action(async()=>{const mark={...spot,kind,author:role==='teacher'?'Teacher':name||'Student',body:body.trim()};if(room){const saved=await api({action:'marker',...mark});await loadRoom(room);setSelected(saved.id);setTab('conversation')}else{const m={...mark,id:crypto.randomUUID(),resolved:0,created:Date.now()};setMarkers(marks=>[...marks,m]);setSelected(m.id)}setSpot(null);setBody('');setPlacing(false);setNotice('Marker added to this slide.');})}
 async function sendReply(){if(!active)return;await action(async()=>{const data={id:active.id,body:reply,author:role==='teacher'?'Teacher':name||'Student'};if(room){await api({action:'reply',...data});await loadRoom(room)}else setReplies(r=>[...r,{...data,id:crypto.randomUUID(),marker:active.id}]);setReply('')})}
 async function resolve(){if(!active)return;await action(async()=>{if(room){await api({action:'resolve',id:active.id,resolved:!active.resolved});await loadRoom(room)}else {const next=markers.map(m=>m.id===active.id?{...m,resolved:m.resolved?0:1}:m);setMarkers(next);if(deck){const updated={...deck,sampleMarkers:next.map(m=>({...m,kind:m.kind as 'question'|'explain'|'idea',response:replies.filter(r=>r.marker===m.id).map(r=>r.body).join('\n\n')}))};setDeck(updated);await savePresentation(updated)}}})}
 function markerColor(marker:Mark){return marker.author==='Teacher'?'var(--teacher-marker)':'var(--student-marker)'}
 function openProjector(){
   if(!room){setNotice('Start a live lesson to connect a projector.');return}
   const url = new URL(location.pathname, location.origin);
   url.searchParams.set('view','projector');
   url.searchParams.set('room',room);
   url.searchParams.set('theme',document.documentElement.dataset.theme||'dark');
   window.open(url.href,'_blank','noopener');
 }
 const openQuestions=markers.filter(m=>m.author!=='Teacher'&&!m.resolved).sort((a,b)=>a.slide-b.slide||a.created-b.created);
 const resolvedQuestions=markers.filter(m=>m.resolved).length;
 function nextOpenQuestion(){if(!openQuestions.length)return;const at=openQuestions.findIndex(m=>m.id===selected);pick(openQuestions[(at+1)%openQuestions.length]);}
 const visible=markers.filter(m=>(scope==='all'||m.slide===index)&&(showResolved||!m.resolved)&&(filter==='all'||m.kind===filter)&&[m.body,m.author,...replies.filter(r=>r.marker===m.id).map(r=>r.body)].join(' ').toLowerCase().includes(markerSearch.trim().toLowerCase())).sort((a,b)=>markerOrder==='oldest'?a.created-b.created:b.created-a.created);
 function pick(m:Mark){if(m.slide!==index){setIndex(m.slide);if(role==='student')setFollow(false);else if(room)action(async()=>{await api({action:'control',current:m.slide})})}setEditing(false);setReviewing(true);setSelected(m.id);setTab('conversation');setSpot(null);setPlacing(false);}
 function exportLesson(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({title,slides,markers,replies},null,2)],{type:'application/json'}));a.download='liveboard-lesson.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 async function importLesson(file:File){try{const d=JSON.parse(await file.text());if(!Array.isArray(d.slides)||!d.slides.length||d.slides.length>40||!d.slides.every((s:any)=>['title','body','kicker','detail','visual','notes'].every(k=>typeof s[k]==='string')))throw Error();setSlides(d.slides.map(objectSlide));setShowStudentMarkers(d.studentMarkers!==0);setTitle(typeof d.title==='string'?d.title:'Imported lesson');setIndex(0);setMarkers([]);setReplies([]);setSelected(null);setNotice('Lesson imported. Start a live room when you are ready.')}catch{setNotice('Choose a valid LiveBoard lesson JSON file.')}}
 if(!ready)return <div className="app" role="status" style={{padding:40}}>Opening LiveBoard…</div>;
 if(library)return <PresentationLibrary renderVisual={type=><Visual type={type}/>}/>;
 if(role==='student'&&!room)return <div ref={appRef} className="app student-waiting"><WaitingRoom code={joinCode} setCode={setJoinCode} name={name} setName={setName} busy={busy} onJoin={join} onFullscreen={toggleFullscreen}/>{notice&&<div className="toast" role="status">{notice}</div>}</div>;
 return <div ref={appRef} className={'app '+(focus?'focus':'')+' '+role+'-view'+(editing?' editing-side':'')+(!reviewing&&!editing?' slide-expanded':'')+((active||spot)?' workspace-open':'')+(!reviewing&&spot?' marker-composer-open':'')}><header className="topbar"><span className="brand"><span className="brandmark"><i/><i/><i/></span>LiveBoard</span>{role==='teacher'&&<button className="header-home" aria-label="All presentations" title="Home" onClick={toLibrary}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/></svg></button>}{role==='teacher'&&<a className="outline student-join-link" href={location.pathname+'?view=student&theme='+(document.documentElement.dataset.theme||'dark')}>Student join view ↗</a>}<div className="top-middle"><span className="status-dot"/>{room?'Room '+room:role==='teacher'?(deck?'Saved in this browser':'Example lesson · not saved yet'):'LiveBoard classroom'}</div></header>
 <div className="workspace">{role==='teacher'&&<aside className="slide-rail"><div className="rail-heading"><span>YOUR LESSON</span><button title="Lesson options" aria-label="Lesson options" onClick={()=>setModal('lesson')}>•••</button></div><h3>{title}</h3><div className="rail-sub">{slides.length} slide{slides.length===1?'':'s'}{deck?.className?<> <span>•</span> {deck.className}</>:null}</div><nav aria-label="Slides" onKeyDown={e=>{if((e.key==='Delete'||e.key==='Backspace')&&highlighted!==null&&!(e.target as Element).closest('input,textarea,[contenteditable]')){e.preventDefault();if(!room)deleteSlide(highlighted)}}}>{slides.map((s,i)=><button className={'thumbnail '+(index===i?'current ':'')+(highlighted===i?'slide-highlighted ':'')+(dragged===i?'slide-dragging':'')} key={i} aria-label={'Slide '+(i+1)+': '+s.title} draggable={!room} onDoubleClick={()=>setHighlighted(i)} onDragStart={e=>{dragSlide.current=i;setDragged(i);setHighlighted(i);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i))}} onDragOver={e=>{if(room||dragSlide.current===null)return;e.preventDefault();if(dragSlide.current!==i){moveSlide(dragSlide.current,i);dragSlide.current=i;setDragged(i)}}} onDrop={e=>{e.preventDefault();dragSlide.current=null;setDragged(null)}} onDragEnd={()=>{dragSlide.current=null;setDragged(null)}} onClick={()=>navigate(i)}><span className="slide-number">{String(i+1).padStart(2,'0')}</span><div className="mini-slide"><span>{s.kicker.split(' / ')[1]||'SLIDE'}</span><strong>{s.title}</strong><div className={'mini-drawing '+s.visual}><i/><i/><i/></div></div><span className="thumb-title">{s.title.replace('\n',' ')}</span>{markers.some(m=>m.slide===i&&!m.resolved)&&<i className="thumb-count" title="Open markers on this slide">{markers.filter(m=>m.slide===i&&!m.resolved).length}</i>}</button>)}</nav>{role==='teacher'&&<button className="add-slide" disabled={!!room} onClick={()=>{const s={title:'A new perspective.',kicker:String(slides.length+1).padStart(2,'0')+' / EXPLORE',body:'What would you like your students to explore?',detail:'Drop a marker to start the conversation.',visual:'questions',notes:''};setSlides([...slides,s]);setIndex(slides.length);setEdit(s);setModal('edit')}}>＋ Add a slide</button>}</aside>}
 <main><section className="lesson-heading"><div><div className="eyebrow">{role==='teacher'?<a className="crumb" href={location.pathname+"?view=library"} onClick={event=>{event.preventDefault();toLibrary()}}>← PRESENTATIONS</a>:'CLASS'}{[deck?.className,deck?.unit,deck?.topic].filter(Boolean).map(v=><span key={v}> <span>/</span> {v!.toUpperCase()}</span>)}{room?<> <span>/</span> LIVE</>:null}</div><h1>{title}</h1></div><div className="lesson-actions">{role==='teacher'&&!room&&<button className="outline" disabled={busy} onClick={()=>action(async()=>{await saveDeck();setNotice('Presentation saved.')})}>Save presentation</button>}{room&&role==='teacher'&&<button className="outline" onClick={()=>setModal('share')}>Invite students</button>}{room&&role==='teacher'&&<button className="outline" title="Leave the room and review what the class asked" onClick={toLibrary}>End class</button>}{role==='teacher'&&<button className="primary" disabled={busy} onClick={()=>room?openProjector():start()}>{room?'Open projector':'▶ Start live lesson'}</button>}</div></section>
 <div className={'question-bar '+(open?'is-open':'')}><div className="q-icon">{open?'◷':'◉'}</div><div><strong>{open?'Discussion in progress':role==='teacher'?'Discussion':'Follow along. Your next question starts with a marker.'}</strong><p>{open?'Explore your students’ markers while the timer runs.':role==='teacher'?'Set a length, then invite your students to add markers.':'Drop a marker whenever you have a question.'}</p></div>{open&&<span className="timer">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>}{role==='teacher'?<div className="q-controls">{open&&<button onClick={extendDiscussion} disabled={busy}>+30 sec</button>}{!open&&<div className="discussion-duration"><button aria-expanded={durationOpen} aria-controls="discussionLength" onClick={()=>setDurationOpen(v=>!v)}>Discussion length <small>{Math.floor(duration/60)}m {duration%60}s</small></button>{durationOpen&&<div className="duration-popover" id="discussionLength"><strong>Discussion length</strong><output aria-live="polite">{Math.floor(duration/60)} min {duration%60} sec</output><label>Minutes<span className="duration-track"><span className="duration-step-dots" aria-hidden="true">{Array.from({length:11},(_,i)=><i key={i}/>)}</span><input type="range" aria-label="Discussion minutes" min="0" max="10" step="1" value={Math.floor(duration/60)} onChange={e=>setDuration(Math.min(600,Number(e.target.value)*60+duration%60))}/></span></label><div className="duration-ticks"><span>0 min</span><span>10 min</span></div><label className="seconds-range">Seconds<span className="duration-track"><span className="duration-step-dots" aria-hidden="true">{Array.from({length:4},(_,i)=><i key={i}/>)}</span><input type="range" aria-label="Discussion seconds" min="0" max="45" step="15" value={duration%60} onChange={e=>setDuration(Math.min(600,Math.floor(duration/60)*60+Number(e.target.value)))}/></span></label><div className="duration-ticks seconds-ticks"><span>0s</span><span>15s</span><span>30s</span><span>45s</span></div></div>}</div>}<button disabled={busy} onClick={questionTime}>{open?'End':'Start discussion'} <span>↗</span></button></div>:<span className="live-pill">{open?'Your turn':'Markers open'}</span>}</div>
 {role==='teacher'&&<div className="question-review-strip"><span><b>{openQuestions.length}</b> student markers open</span><span><b>{resolvedQuestions}</b> markers resolved</span><div className="review-actions"><button className={'outline student-markers-toggle '+(showStudentMarkers?'is-on':'')} aria-pressed={showStudentMarkers} title="Allow students to add markers during the live lesson" disabled={busy} onClick={()=>{if(room)action(async()=>{await api({action:'control',studentMarkers:!showStudentMarkers});await loadRoom(room)});else setShowStudentMarkers(value=>!value)}}><span className="toggle-track" aria-hidden="true"><i/></span>Student markers</button>{reviewing&&<><button className="outline previous-marker-button" disabled={!markers.length} onClick={()=>{const ordered=markers.slice().sort((a,b)=>a.slide-b.slide||a.created-b.created);if(!ordered.length)return;const at=ordered.findIndex(m=>m.id===selected);pick(ordered[(at<=0?ordered.length:at)-1])}}>← Previous marker</button><button className="outline next-marker-button" disabled={!markers.length} onClick={()=>{const ordered=markers.slice().sort((a,b)=>a.slide-b.slide||a.created-b.created);if(!ordered.length)return;const at=ordered.findIndex(m=>m.id===selected);pick(ordered[(at+1)%ordered.length])}}>Next marker →</button></>}<button className="outline review-marker-button" disabled={!reviewing&&!markers.length} onClick={()=>{if(reviewing){setReviewing(false);setSelected(null);setSpot(null)}else{setEditing(false);setReviewing(true);setSelected(null);setSpot(null)}}}>{reviewing?'Close review ↙':'Review open markers ↗'}</button></div></div>}

 <div className="presentation-area"><section className="presentation"><div className="canvas-toolbar"><span><span className="status-dot"/>{room?'LIVE CLASSROOM':'EXAMPLE LESSON'}</span><div>{role==='student'&&room&&<button onClick={()=>{setFollow(true);setIndex(liveIndex);setSelected(null)}}>{follow?'● Following live':'↻ Follow live'}</button>}{room&&role==='student'&&markers.some(m=>m.author!=='Teacher')&&<button title="Download your questions and the answers, to study from in LiveBoard" onClick={keepQuestions}>⤓ Keep my questions</button>}{role==='teacher'&&<button disabled={!!room} onClick={()=>{setSlides(s=>s.map(objectSlide));setEditing(true);setReviewing(false);setSelected(null);setSpot(null)}}>✎ Edit slide</button>}</div></div>
 <div ref={slideRef} className={'slide-canvas '+(placing?'placing':'')} onPointerDown={event=>{
   if (!placing || event.button!==0 || (event.target as Element).closest('button')) return;
   event.preventDefault();
   origin.current=pointerPosition(event);
   event.currentTarget.setPointerCapture(event.pointerId);
 }} onPointerMove={event=>{
   if (origin.current) setSelection(regionBetween(origin.current,pointerPosition(event)));
 }} onPointerUp={finishPlacement} onPointerCancel={cancelPlacement}
 onKeyDown={event=>{
   if (event.key==='Escape') cancelPlacement();
   if (placing && event.target===event.currentTarget && (event.key==='Enter'||event.key===' ')) {
     event.preventDefault();
     cancelPlacement();
     setSpot({x:50,y:50,slide:index});
   }
 }} tabIndex={placing?0:-1} aria-label={placing?"Click to pin, drag to select a region, or press Enter to pin the center":undefined}><div className={'slide-content '+(slide.objectLayout?'object-layout':slide.visual==='uploaded-slide'?'imported-content':'')}><div className="slide-kicker">{slide.kicker}</div><h2>{slide.title.split('\n').map((line,i)=><span key={i}>{line}<br/></span>)}</h2><p className="slide-body">{slide.body}</p>{slide.image?<img className="slide-upload" src={slide.image} alt={slide.title}/>:<Visual type={slide.visual}/>}<div className="slide-takeaway"><span>↳</span>{slide.detail}</div><footer><span>LIVEBOARD{deck?.className?<> <i>/</i> {deck.className.toUpperCase()}</>:null}</span><span>{String(index+1).padStart(2,'0')}</span></footer></div>{markers.filter(m=>m.slide===index&&(role!=='projector'||m.author==='Teacher')).map(m=><button key={m.id} className={'pin free '+(m.resolved?'resolved':'')+(selected===m.id?' selected':'')} style={{left:m.x+'%',top:m.y+'%','--tc':markerColor(m)} as any} title={m.author+': '+m.body} aria-label={'Open '+kinds[m.kind]?.label+' from '+m.author} onClick={e=>{e.stopPropagation();if(role!=='projector')pick(m)}}/>)}{(selection || (spot?.slide===index ? spot.region : undefined) || (active?.slide===index ? active.region : undefined)) && <span className="region-outline" aria-hidden="true" style={regionStyle((selection || spot?.region || active?.region)!)}/>}
 <SlideElements slide={slide} editable={editing} selected={selectedElement} onSelect={setSelectedElement} renderVisual={type=><Visual type={type}/>} cropId={cropId} onCrop={setCropId} onChange={elements=>changeSlide(syncElements(slide,elements))}/>
 {spot?.slide===index&&<span className="pin free draft-pin" style={{left:spot.x+'%',top:spot.y+'%','--tc':role==='teacher'?'var(--teacher-marker)':'var(--student-marker)'} as any}/>} {placing&&<div className="placement-hint">Click to pin or drag to capture a region <button onClick={e=>{e.stopPropagation();cancelPlacement()}}>Cancel</button></div>}</div>
 <div className="marker-legend"><span className="teacher-key">● Teacher</span><span className="student-key">● {role==='student'?'Yours':'Students'}</span></div>{role==='teacher'&&(<div className="slide-edit-actions" aria-label="Slide actions"><button disabled={!!room||index===0} onClick={()=>moveSlide(index,index-1)}>↑ Move earlier</button><button disabled={!!room||index===slides.length-1} onClick={()=>moveSlide(index,index+1)}>↓ Move later</button><button disabled={!!room||slides.length>=40} onClick={()=>duplicateSlide(index)}>Duplicate slide</button><button disabled={!!room||slides.length===1} onClick={()=>deleteSlide(highlighted??index)}>Delete slide</button></div>)}<div className="slide-controls"><div><button aria-label="Previous slide" disabled={index===0} onClick={()=>navigate(index-1)}>←</button><span>{String(index+1).padStart(2,'0')} <i>/ {String(slides.length).padStart(2,'0')}</i></span><button aria-label="Next slide" disabled={index===slides.length-1} onClick={()=>navigate(index+1)}>→</button></div><span className="marker-count">{markers.filter(m=>m.slide===index).length} markers on this slide</span><button className="place-button" disabled={capturing||(role==='student'&&!showStudentMarkers)} title={role==='student'&&!showStudentMarkers?'Your teacher has paused student markers':undefined} onClick={()=>{if(placing){cancelPlacement();return}if(role==='student'&&room)setFollow(false);setPlacing(true)}}><span className="small-pin"/>{placing?'Cancel placement':'Drop a marker'}</button></div>
 {role==='teacher'&&<details className="speaker-notes" open><summary>✧ Teacher’s notes <span>Only in teacher view</span></summary><p>{slide.notes||'Add speaking notes using Edit slide.'}</p></details>}
 </section>
 {editing&&role==='teacher'?<SlideEditor slide={slide} selected={selectedElement} onSelect={setSelectedElement} onUndo={undoEdit} onRedo={redoEdit} canUndo={!!historyRef.current?.canUndo} canRedo={!!historyRef.current?.canRedo} onChange={changeSlide} onClose={()=>setEditing(false)}/>:role!=='projector'&&<aside className="discussion"><div className="discussion-header"><div><span className="eyebrow">THE CONVERSATION</span><h2>{spot?'New marker':active?kinds[active.kind]?.label:'Markers'}</h2></div>{(active||spot)&&<button className="icon-button" aria-label="Back to marker overview" onClick={()=>{setSelected(null);setSpot(null)}}>×</button>}</div>
 {spot?<div className="composer"><p className="context-tag">◉ Anchored to slide {spot.slide+1}</p>{capturing&&<p role="status">Capturing slide region…</p>}{spot.screenshot&&<img className="marker-screenshot" src={spot.screenshot} alt="Selected slide region"/>}<h3>What’s on your mind?</h3><div className="intent-list">{Object.entries(kinds).map(([id,k]:any)=><button key={id} className={kind===id?'chosen':''} onClick={()=>setKind(id)}><i style={{color:k.color}}>{k.icon}</i>{k.verb}<span>{kind===id?'●':'○'}</span></button>)}</div>{role==='student'&&<label>Your name<input value={name} maxLength={40} placeholder="First name or nickname" onChange={e=>setName(e.target.value)}/></label>}<label>{kinds[kind].verb}<textarea autoFocus value={body} maxLength={2000} placeholder={kind==='question'?'What are you wondering about?':kind==='explain'?'Which part would you like explained further?':'What possibility would you like to explore?'} onChange={e=>setBody(e.target.value)}/></label><button className="primary full" disabled={!body.trim()||busy||capturing} onClick={createMarker}>Add marker ↗</button><p className="fineprint">Your request stays connected to this exact place on the slide.</p></div>:active?<div className="marker-workspace"><div className="context-tag">◉ Slide {active.slide+1} <span>{active.resolved?'Resolved':'Open conversation'}</span></div><div className="request-card" style={{'--tc':markerColor(active)} as any}><div><span className="mini-avatar">{active.author.slice(0,1)}</span><b>{active.author}</b><small>{kinds[active.kind]?.label}</small></div><p>{active.body}</p>{active.screenshot&&<img className="marker-screenshot" src={active.screenshot} alt="Slide region attached to this marker"/>}</div><><div className="thread">{replies.filter(r=>r.marker===active.id).length===0?<div className="thread-empty"><span>↳</span><p>This is where understanding grows.</p><small>Add an explanation or a follow-up.</small></div>:replies.filter(r=>r.marker===active.id).map(r=><div className={'reply '+(r.author==='Teacher'?'teacher-reply':'')} key={r.id}><b>{r.author}</b><p>{r.body}</p>{r.image&&<><img src={r.image} alt={r.body}/><a target="_blank" rel="noreferrer" href={r.source}>Image source & attribution ↗</a></>}</div>)}</div><label className="sr-only" htmlFor="reply">Write a response</label><textarea id="reply" value={reply} maxLength={2000} placeholder={role==='teacher'?'Help connect the dots…':'Add to the conversation…'} onChange={e=>setReply(e.target.value)}/><button className="primary full" disabled={busy||!reply.trim()} onClick={()=>sendReply()}>Send response ↗</button></>{role==='teacher'&&<button className="resolve-button" disabled={busy} onClick={resolve}>{active.resolved?'↺ Reopen marker':'✓ Mark as resolved'}</button>}</div>:<><div className="marker-search-tools"><input type="search" aria-label="Search markers" placeholder="Search markers or replies…" value={markerSearch} onChange={e=>setMarkerSearch(e.target.value)}/><select aria-label="Sort markers" value={markerOrder} onChange={e=>setMarkerOrder(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div><div className="queue-top"><span>{markers.filter(m=>!m.resolved).length} open markers</span><select aria-label="Marker scope" value={scope} onChange={e=>setScope(e.target.value)}><option value="slide">This slide</option><option value="all">All slides</option></select></div><div className="filter-row">{['all','question','explain','idea'].map(k=><button key={k} title={k==='all'?'All markers':k==='resolved'?'Resolved':kinds[k].label} className={filter===k?'on':''} onClick={()=>setFilter(k)}>{k==='all'?'All':k==='resolved'?'✓':kinds[k].icon}</button>)}<button aria-pressed={showResolved} aria-label="Include resolved markers" title="Include resolved markers" className={showResolved?'on':''} onClick={()=>setShowResolved(v=>!v)}>✓</button></div><div className="marker-list">{visible.length?visible.map(m=><button className="marker-card" key={m.id} onClick={()=>pick(m)} style={{'--tc':markerColor(m)} as any}><div><span className="intent-dot">{kinds[m.kind]?.icon}</span><b>{kinds[m.kind]?.label}</b><span className="card-chevron">↗</span></div><p>{m.body}</p><footer><span className="mini-avatar">{m.author.slice(0,1)}</span>{m.author}<i>•</i>Slide {m.slide+1}{!!m.resolved&&<span>✓</span>}</footer></button>):<div className="queue-empty"><span>◎</span><h3>A little space for curiosity.</h3><p>{filter==='all'?'Markers placed on the slide will appear here.':'No markers match this filter yet.'}</p></div>}</div></>}
 </aside>}</div></main></div>
 {notice&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>}
 {previewLive&&<div className="student-live-preview" role="dialog" aria-modal="true" aria-label="Student live preview"><header><span>LiveBoard · Student preview</span><button className="outline" onClick={()=>setPreviewLive(false)}>Close preview</button></header><div className={'student-preview-status '+(open?'active':'')}>{open?`Discussion open · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'Follow along · markers stay connected to the slide'}</div><div className="slide-canvas"><SlideFace slide={slide} number={index} renderVisual={type=><Visual type={type}/>}/>{markers.filter(m=>m.slide===index).map(m=><button key={m.id} className="pin free" style={{left:m.x+'%',top:m.y+'%','--tc':'var(--student-marker)'} as any} aria-label={m.body} title={m.body}/>)}</div><footer><button className="outline" disabled={!index} onClick={()=>setIndex(i=>i-1)}>← Previous slide</button><span>{index+1} / {slides.length}</span><button className="outline" disabled={index===slides.length-1} onClick={()=>setIndex(i=>i+1)}>Next slide →</button></footer><p>This previews the student layout using example markers.</p></div>}
 {modal&&<div className="modal-backdrop" onClick={()=>setModal('')}><section className="modal" role="dialog" aria-modal="true" aria-label={modal==='edit'?'Edit slide':'Lesson options'} onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={()=>setModal('')}>×</button>{modal==='join'||modal==='resume'?<><span className="eyebrow">STEP INTO THE LESSON</span><h2>{modal==='resume'?'Resume your classroom.':'A shared slide.\nYour own questions.'}</h2><p>Enter the room code from your teacher.</p><label>Your name<input value={name} maxLength={40} onChange={e=>setName(e.target.value)} placeholder="First name or nickname"/></label><label>Room code<input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="8-character room code" maxLength={8}/></label><button className="primary full" disabled={busy||joinCode.length!==8} onClick={join}>{busy?'Connecting…':modal==='resume'?'Resume lesson':'Join lesson ↗'}</button></>:modal==='share'?<><span className="eyebrow">BETTER TOGETHER</span><h2>Invite a little curiosity.</h2><p>Students join using this code or the lesson link.</p><div className="room-code">{room}</div><button className="primary full" onClick={()=>navigator.clipboard.writeText(location.origin+'/?room='+room+'&theme='+(document.documentElement.dataset.theme||'dark')).then(()=>setNotice('Student link copied.')).catch(()=>setNotice('Copy the room code above to share.'))}>Copy student link ↗</button><p className="fineprint">Send the room code or link to your students.</p></>:modal==='edit'&&edit?<><span className="eyebrow">MAKE IT YOURS</span><h2>Edit slide {index+1}</h2>{(['title','kicker','body','detail','notes'] as const).map(k=><label key={k}>{({title:'Title',kicker:'Section label',body:'Main idea',detail:'Takeaway',notes:'Teacher notes'})[k]}<textarea value={edit[k]} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></label>)}<label>Visual<select value={edit.visual} onChange={e=>setEdit({...edit,visual:e.target.value,image:undefined})}><option value="reaction">Reaction model</option><option value="graph">Concentration graph</option><option value="bottle">Carbonated water</option><option value="questions">Marker prompts</option></select></label><label>Or upload a slide image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>500000){setNotice('Use an image smaller than 500 KB.');return}const r=new FileReader();r.onload=()=>setEdit({...edit,image:String(r.result)});r.readAsDataURL(f)}}/></label><button className="primary full" onClick={()=>{setSlides(s=>s.map((v,i)=>i===index?edit:v));setModal('')}}>Save slide</button></>:modal==='lesson'?<><span className="eyebrow">LESSON STUDIO</span><h2>Your next conversation.</h2><label>Lesson title<input value={title} disabled={!!room} onChange={e=>setTitle(e.target.value)}/></label><button className="outline full" onClick={exportLesson}>Download lesson & discussion</button>{!room&&<><label>Import a LiveBoard lesson<input type="file" accept="application/json,.json" onChange={e=>{if(e.target.files?.[0])importLesson(e.target.files[0]);setModal('')}}/></label><button className="outline full" onClick={()=>setModal('resume')}>Resume a saved room</button></>}<p className="fineprint">Edit slides before starting a room. Your live room preserves its lesson and discussion.</p></>:<><span className="eyebrow">MEET THE MARKER</span><h2>A point on a slide.<br/>A door to understanding.</h2><div className="help-step"><b>01</b><div><h3>Present, then pause.</h3><p>Move through the slides. Open a timed question window when the class needs room to think.</p></div></div><div className="help-step"><b>02</b><div><h3>Point to what matters.</h3><p>Click to pin a spot or drag around part of the slide to attach a screenshot. Teachers and students can add questions, elaboration requests, and ideas.</p></div></div><div className="help-step"><b>03</b><div><h3>Explore it together.</h3><p>Open the marker, reply, pull in images, and resolve it when the explanation lands. Every thread keeps its context.</p></div></div><p className="fineprint">Marker appearance and anchored-workspace behavior adapted from Vinuboi321/LiveBoard. Replies are written by participants; image search retrieves real Wikimedia Commons results.</p></>}</section></div>}
 </div>
}
