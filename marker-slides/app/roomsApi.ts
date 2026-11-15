/* How the classroom talks to its live-class server. Inside LiveBoard the app plugs in its own backend (Supabase,
   see src/classroom/rooms.ts); on its own this falls back to the /api/rooms route in this folder (Cloudflare D1),
   which is what local development of the stand-alone classroom uses. Both answer in the same shapes. */
export type Who={secret?:string;participant?:string;projector?:boolean};
export type RoomsBackend={
  get(id:string,who:Who):Promise<any>;
  post(room:string,data:Record<string,unknown>&{action:string},who:Who):Promise<any>;
  /** True when ending a class deletes the room on the server. */
  canEnd?:boolean;
};
const headers=(who:Who):Record<string,string>=>({'x-participant':who.participant||'',...(who.secret?{Authorization:'Bearer '+who.secret}:{})});
async function answer(r:Response){let d:any=null;try{d=await r.json()}catch{}if(!r.ok)throw Error(d?.error||'Live classes are not available here yet.');return d}
const http:RoomsBackend={
  canEnd:true,
  get:async(id,who)=>answer(await fetch('/api/rooms?id='+encodeURIComponent(id)+(who.projector?'&view=projector':''),{headers:headers(who)})),
  post:async(room,data,who)=>answer(await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',...headers(who)},body:JSON.stringify({...data,room})}))
};
let backend:RoomsBackend=http;
export const setRoomsBackend=(b:RoomsBackend)=>{backend=b};
export const rooms:RoomsBackend={get:(id,who)=>backend.get(id,who),post:(room,data,who)=>backend.post(room,data,who),get canEnd(){return !!backend.canEnd}};
