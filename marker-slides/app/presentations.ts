import { objectSlide } from './objectLayout';
import type { Slide } from './data';

export type SampleMarker = {
  id:string; slide:number; x:number; y:number; kind:'question'|'explain'|'idea';
  author:string; body:string; response:string; resolved:number; created:number;
};

/** What a live class left behind: the questions students placed on the slides, kept with the deck in this browser so
 *  the teacher can see where the class got stuck. Text only: no screenshots and no student ids. */
export type SessionQuestion = { x?:number; y?:number; slide:number; kind:string; author:string; body:string; resolved:number; replies:string[] };
export type Session = { room:string; at:number; total:number; open:number; bySlide:number[]; questions:SessionQuestion[] };

export type Presentation = {
  id: string;
  title: string;
  slides: Slide[];
  className: string;
  unit: string;
  topic: string;
  updated: number;
  /** When it was last opened from the home screen; the most recent one is shown in front. */
  opened?: number;
  created?: number;
  sampleMarkers?: SampleMarker[];
  lastSession?: Session;
};

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('liveboard-presentations',2);
    request.onupgradeneeded = () => {if(!request.result.objectStoreNames.contains('decks'))request.result.createObjectStore('decks',{keyPath:'id'});if(!request.result.objectStoreNames.contains('libraryBackups'))request.result.createObjectStore('libraryBackups',{keyPath:'id'});};
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function access<T>(mode:IDBTransactionMode, operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await openLibrary();
  try {
    return await new Promise((resolve,reject) => {
      const transaction=db.transaction('decks',mode);
      const request=operation(transaction.objectStore('decks'));
      transaction.oncomplete=()=>resolve(request.result);
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const listPresentations=()=>access<Presentation[]>('readonly',store=>store.getAll()).then(decks=>decks.map(deck=>({...deck,slides:deck.slides.map(objectSlide)})));
export const getPresentation=(id:string)=>access<Presentation|undefined>('readonly',store=>store.get(id)).then(deck=>deck?{...deck,slides:deck.slides.map(objectSlide)}:undefined);
export const savePresentation=(deck:Presentation)=>{
 try{if(JSON.parse(localStorage.getItem('liveboard-replaced-deck-ids')||'[]').includes(deck.id))return Promise.reject(new Error('This presentation was replaced. Open the library for the new decks.'))}catch{}
 return access('readwrite',store=>{
  const previous=store.get(deck.id);
  previous.onsuccess=()=>{ const existing=previous.result as Presentation|undefined; store.put({...deck,created:existing?existing.created:(deck.created??Date.now())}); };
  return previous;
});
};
export const deletePresentation=(id:string)=>access('readwrite',store=>store.delete(id));
