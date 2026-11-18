import type { ClassesBackend, QuizResult, RosterRow, StudentWork, TeacherClass, TeacherQuiz } from './classesApi';

/* Sample classes for the single-file preview, which has no server: two classes with a few students and their work,
   kept in memory, so a teacher can try the Classes screen. Nothing here is real. */
const H=36e5,D=24*H;
export function sampleClasses():ClassesBackend{
  const now=Date.now();
  const classes:TeacherClass[]=[
    {id:'c-bio',name:'AP Biology · period 3',code:'BIO4KX',students:4,liveRoom:null,liveTitle:null},
    {id:'c-chem',name:'Chemistry 101',code:'CHM7QP',students:3,liveRoom:null,liveTitle:null}
  ];
  const row=(userId:string,name:string,notes:number,markers:number,mastered:number,due:number,points:number,ago:number|null,shares=true):RosterRow=>({userId,name,joined:new Date(now-20*D).toISOString(),shares,notes,markers,mastered,due,points,lastActive:ago===null?null:now-ago});
  const rosters:Record<string,RosterRow[]>={
    'c-bio':[row('s1','Priya Shah',6,21,14,3,42,2*H),row('s2','Marcus Lee',4,12,5,6,31,D),row('s3','Jo Park',2,5,1,4,24,3*D),row('s4','Sam Ortiz',0,0,0,0,0,null,false)],
    'c-chem':[row('s5','Ava Chen',3,9,6,1,18,5*H),row('s6','Leo Grant',1,2,0,2,6,6*D),row('s7','Nia Brooks',2,7,4,0,15,D)]
  };
  const work=(r:RosterRow):StudentWork=>({
    notes:Array.from({length:Math.min(r.notes,3)},(_,i)=>({id:r.userId+'-n'+i,title:['The little powerhouses','Photosynthesis, light reactions','Enzymes and activation energy'][i],kind:'lecture',updated:now-(i+1)*D,text:['Mitochondria are where most of a cell\'s ATP is made. The electron transport chain pumps protons into the intermembrane space. As protons flow back through ATP synthase, ATP is produced.','Light hits photosystem II and splits water. Electrons move down a chain to photosystem I, building a proton gradient on the way.','Enzymes lower activation energy. They do not change ΔG of the reaction.'][i]})),
    markers:Array.from({length:Math.min(r.markers,6)},(_,i)=>({id:r.userId+'-m'+i,noteId:r.userId+'-n'+(i%Math.max(1,Math.min(r.notes,3))),type:['question','explain','math','question','explain','note'][i],text:['As protons flow back through ATP synthase, ATP is produced.','The electron transport chain pumps protons','about 30 ATP per glucose','splits water','activation energy','cristae'][i],mastery:[2,1,2,0,1,2][i],due:now+(i-2)*D,understanding:['understood','working',null,'unresolved','working',null][i]}))
  });
  const quizzes:Record<string,(TeacherQuiz&{qs:{q:string;a:string}[]})[]>={'c-bio':[{id:'q1',title:'Cell respiration check',questions:3,required:true,dueAt:new Date(now+D).toISOString(),closed:false,createdAt:new Date(now-5*H).toISOString(),done:2,students:4,avgPct:67,
    qs:[{q:'Where is most ATP made?',a:'In the mitochondria, by ATP synthase'},{q:'What does the electron transport chain pump?',a:'Protons, into the intermembrane space'},{q:'Roughly how many ATP per glucose?',a:'About 30'}]}]};
  const results=(quizId:string,classId:string):QuizResult[]=>(rosters[classId]||[]).map((r,i)=>i<2&&quizId==='q1'?{userId:r.userId,name:r.name,done:true,score:i?1:3,total:3,finishedAt:new Date(now-(i+1)*H).toISOString(),answers:[{got:true,said:i?'cytoplasm':'mitochondria'},{got:!i,said:i?'electrons':'protons'},{got:!i,said:i?'':'around 30'}]}:{userId:r.userId,name:r.name,done:false,score:null,total:null,finishedAt:null,answers:[]});
  return{
    quizzes:async(id)=>(quizzes[id]||[]).map(({qs:_q,...q})=>({...q,students:rosters[id]?.length||0})),
    releaseQuiz:async(classId,title,qs,required,dueAt)=>{const id='q'+Date.now();(quizzes[classId]=quizzes[classId]||[]).unshift({id,title:title||'Pop quiz',questions:qs.length,required,dueAt,closed:false,createdAt:new Date().toISOString(),done:0,students:rosters[classId]?.length||0,avgPct:null,qs});return id},
    quizResults:async(quizId)=>{const c=Object.keys(quizzes).find(k=>quizzes[k].some(q=>q.id===quizId))||'';return results(quizId,c)},
    closeQuiz:async(quizId,remove)=>{for(const k of Object.keys(quizzes)){const i=quizzes[k].findIndex(q=>q.id===quizId);if(i<0)continue;if(remove)quizzes[k].splice(i,1);else quizzes[k][i].closed=true}},
    account:async()=>({email:'teacher@example.com'}),
    list:async()=>classes.map(c=>({...c,students:rosters[c.id]?.length||0})),
    create:async(name)=>{const id='c-'+(now%1e6)+classes.length;const code=Math.random().toString(36).slice(2,8).toUpperCase();classes.push({id,name,code,students:0,liveRoom:null,liveTitle:null});rosters[id]=[];return{id,code}},
    rename:async(id,name)=>{const c=classes.find(c=>c.id===id);if(c)c.name=name},
    remove:async(id)=>{const i=classes.findIndex(c=>c.id===id);if(i>=0)classes.splice(i,1)},
    roster:async(id)=>rosters[id]||[],
    work:async(classId,studentId)=>{const r=(rosters[classId]||[]).find(r=>r.userId===studentId);if(!r||!r.shares)throw Error('Not shared.');return work(r)},
    tieRoom:async(room,_secret,classId)=>{for(const c of classes){if(c.liveRoom===room){c.liveRoom=null;c.liveTitle=null}if(c.id===classId){c.liveRoom=room;c.liveTitle='This lesson'}}}
  };
}
