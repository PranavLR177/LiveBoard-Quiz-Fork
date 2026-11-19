import { useEffect, useRef, useState } from 'react';
import { quizPicture } from './slideQuiz';

type Hit={pageid:number;title:string;imageinfo?:{thumburl?:string;descriptionurl:string}[]};
export default function QuizImageSearch({onPick,onClose}:{onPick:(image:string,source:string)=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const request=useRef<AbortController|null>(null);
  const [query,setQuery]=useState(''),[hits,setHits]=useState<Hit[]>([]),[status,setStatus]=useState('');
  useEffect(()=>{dialog.current?.showModal();return ()=>request.current?.abort()},[]);
  async function search(){
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setHits([]);setStatus('Searching Wikimedia Commons…');
    const params=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrnamespace:'6',gsrsearch:query.trim()+' filetype:bitmap',gsrlimit:'18',prop:'imageinfo',iiprop:'url',iiurlwidth:'480'});
    try{
      const response=await fetch('https://commons.wikimedia.org/w/api.php?'+params,{signal:controller.signal});
      if(!response.ok)throw Error();
      const data=await response.json() as {error?:unknown;query?:{pages?:Record<string,Hit>}};if(data.error)throw Error();
      const matches=Object.values<Hit>(data.query?.pages??{}).filter(h=>h.imageinfo?.[0].thumburl);
      setHits(matches);setStatus(matches.length?'':'No images found. Try another term.');
    }catch{if(!controller.signal.aborted)setStatus('Image search is unavailable. Try again or upload an image.')}
  }
  async function pick(hit:Hit){
    const info=hit.imageinfo![0];request.current?.abort();
    const controller=new AbortController();request.current=controller;setStatus('Adding image…');
    try{const r=await fetch(info.thumburl!,{signal:controller.signal});if(!r.ok)throw Error();
      const url=URL.createObjectURL(await r.blob());
      try{const image=await quizPicture(url);if(!controller.signal.aborted)onPick(image,info.descriptionurl)}finally{URL.revokeObjectURL(url)}
    }catch{if(!controller.signal.aborted)setStatus('Could not add this image. Choose another result.')}
  }
  return <dialog ref={dialog} className="image-search-dialog" aria-label="Search web images" onCancel={onClose}>
    <header><h3>Search web images</h3><button className="outline" onClick={onClose}>Close</button></header>
    <form onSubmit={e=>{e.preventDefault();void search()}}><input autoFocus aria-label="Search Wikimedia Commons" placeholder="Search Wikimedia Commons" value={query} onChange={e=>setQuery(e.target.value)}/><button className="primary" disabled={!query.trim()}>Search</button></form>
    <p role="status">{status}</p><div className="image-results">{hits.map(hit=><div key={hit.pageid}><button onClick={()=>pick(hit)}><img loading="lazy" src={hit.imageinfo![0].thumburl} alt=""/>{hit.title.replace(/^File:/,'')}</button><a target="_blank" rel="noreferrer" href={hit.imageinfo![0].descriptionurl}>Source &amp; license</a></div>)}</div>
  </dialog>;
}
