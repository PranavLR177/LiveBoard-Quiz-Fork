export async function quizAction(db:D1Database, room:{id:string;slides:string}, teacher:boolean, participant:string|null, data:Record<string,unknown>) {
  const error=(message:string,status=400)=>Response.json({error:message},{status});
  if(data.action==='quizList'){
    const {results:questions}=await db.prepare('SELECT id,slide,prompt,image FROM room_quizzes WHERE room=? ORDER BY rowid').bind(room.id).all();
    const {results:answers}=teacher ? await db.prepare('SELECT quiz,name,answer FROM room_quiz_answers WHERE room=? ORDER BY rowid').bind(room.id).all() :
      await db.prepare('SELECT quiz FROM room_quiz_answers WHERE room=? AND participant=?').bind(room.id,participant).all();
    return Response.json(questions.map(q=>({...q,...(teacher?{answers:answers.filter(a=>a.quiz===q.id).map(a=>({name:a.name,answer:a.answer}))}:{answered:answers.some(a=>a.quiz===q.id)})})));
  }
  if(typeof data.id!=='string'||!/^[-\da-f]{36}$/i.test(data.id))return error('Invalid question.');
  if(data.action==='quizShare'||data.action==='quizComplete'){
    if(!teacher)return error('Only the host can share a question.',403);
    if(!Number.isInteger(data.slide)||Number(data.slide)<0||Number(data.slide)>=JSON.parse(room.slides).length||
       typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>1100||typeof data.image!=='string'||
       data.image.length>400000||(data.image&&!/^data:image\/jpeg;base64,[a-z\d+/]+=*$/i.test(data.image)))return error('Invalid question or picture.');
    if(data.action==='quizComplete'){
      const slides=JSON.parse(room.slides), at=Number(data.slide)+1;
      if(slides.some((s:{questionId?:string})=>s.questionId===data.id))return Response.json({ok:true});
      const question={questionId:data.id,title:data.prompt.trim(),image:data.image,orientation:data.orientation==='vertical'?'vertical':'horizontal',kicker:'Q / QUESTION',body:'',notes:'',detail:'',visual:'none'};
      slides.splice(at,0,question);
      const next=JSON.stringify(slides);
      if(slides.length>40||next.length>5000000)return error('Room slide limit reached.');
      const guard=' AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND slides=?)';
      const result=await db.batch([
        db.prepare('UPDATE markers SET slide=slide+1 WHERE room=? AND slide>=?'+guard).bind(room.id,at,room.id,room.slides),
        db.prepare('UPDATE room_quizzes SET slide=CASE WHEN id=? THEN ? ELSE slide+1 END WHERE room=? AND (id=? OR slide>=?)'+guard).bind(data.id,at,room.id,data.id,at,room.id,room.slides),
        db.prepare('UPDATE rooms SET slides=?,current=current+(current>=?) WHERE id=? AND slides=?').bind(next,at,room.id,room.slides)
      ]);
      return result[2].meta.changes?Response.json({ok:true}):error('The lesson changed. Try again.',409);
    }
    await db.prepare('INSERT INTO room_quizzes(room,id,slide,prompt,image) VALUES(?,?,?,?,?) ON CONFLICT(room,id) DO NOTHING').bind(room.id,data.id,data.slide,data.prompt.trim(),data.image).run();
  } else {
    if(!participant||typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>2000)return error('Enter an answer.');
    const quiz=await db.prepare('SELECT id FROM room_quizzes WHERE room=? AND id=?').bind(room.id,data.id).first();
    if(!quiz)return error('Question unavailable.',404);
    await db.prepare('INSERT INTO room_quiz_answers(room,quiz,participant,name,answer) VALUES(?,?,?,?,?) ON CONFLICT(room,quiz,participant) DO NOTHING').bind(room.id,data.id,participant,String(data.name||'Student').slice(0,40),data.answer.trim()).run();
  }
  return Response.json({ok:true});
}
