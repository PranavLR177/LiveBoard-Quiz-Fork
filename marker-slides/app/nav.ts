/* Where the classroom is and how it moves between its screens.
   Normally it is the page /classroom.html and a screen is a query string (?view=library, ?deck=ID, ?room=CODE).
   It can also be embedded inside the notes page (the single-file preview does this, since it has no second page):
   then the "address" is kept here in memory, and the host swaps the two sides in place. */
export type Side='individual'|'student'|'teacher';
type Host={toNotes(as?:Side,hash?:string):void;rerender():void};
let host:Host|null=null,held='';

export function embed(h:Host|null,search:string){host=h;held=search}
export const embedded=()=>!!host;
export const params=()=>new URLSearchParams(host?held:location.search);
/** Opens another classroom screen, e.g. go('?view=library'). */
export function go(search:string){if(host){held=search;host.rerender()}else location.assign(location.pathname+search)}
/** For an <a>: a real address on the web, an in-place switch when embedded. */
export const link=(search:string)=>({href:host?'#':location.pathname+search,onClick:(event:{preventDefault():void})=>{if(host){event.preventDefault();go(search)}}});
/** Leaves for the notes side, optionally as a given role and at a given screen (#teacher is Worksheets). */
export function toNotes(as?:Side,hash=''){host?.toNotes(as,hash)}
