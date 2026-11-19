import { useRef, useState } from 'react';
import QuizImageSearch from './QuizImageSearch';
import SymbolText from './SymbolText';
import { quizPicture, type SlideQuiz, type ModelAnswer } from './slideQuiz';

export function AnswerPane({answer,editing,onChange,onError}:{answer?:ModelAnswer;editing:boolean;onChange:(value:ModelAnswer)=>void;onError:(message:string)=>void}){
  return <section className="answer-pane"><h3>Answer</h3>{editing?<SymbolText label="Answer text" value={answer?.text||''} onChange={text=>onChange({...answer,text})}/>:<p>{answer?.text||'No answer added yet.'}</p>}
    {answer?.image&&<img src={answer.image} alt="Answer illustration"/>}
    {editing&&<label>Answer image<input type="file" accept="image/*" onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return;
      const url=URL.createObjectURL(file);
      try{onChange({text:answer?.text||'',image:await quizPicture(url)})}catch{onError('Could not read the answer image.')}finally{URL.revokeObjectURL(url)}
    }}/></label>}
  </section>;
}

export default function QuizCard({ quiz, editing, review, shared, live, busy, onComplete, onChange, onShare, onError }: {
  quiz: SlideQuiz; editing: boolean; review: boolean; shared: boolean; live: boolean;
  busy:boolean; onComplete:()=>Promise<void>; onChange: (quiz: SlideQuiz) => void; onShare: () => Promise<void>; onError: (message: string) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [menu,setMenu]=useState(false),[web,setWeb]=useState(false);
  return <section className="ghost-stage" aria-label="Quiz question">
    <header><span>{quiz.marker ? 'Marker question' : 'Slide question'}</span><span>{shared ? 'Shared with class' : 'Teacher draft'}</span></header>
    <label>Layout <select value={quiz.orientation||'horizontal'} disabled={!editing} onChange={e=>onChange({...quiz,orientation:e.target.value as SlideQuiz['orientation']})}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>
    <div className="qa-split"><section><h3>Question</h3><div className={'ghost-layout '+(quiz.orientation||'horizontal')}>{editing ? <SymbolText label="Quiz question" placeholder="Write your question…" maxLength={1100} value={quiz.prompt} onChange={prompt => onChange({...quiz, prompt})}/> : <h2>{quiz.prompt || 'Write your question…'}</h2>}
      <div>{quiz.image && <img src={quiz.image} alt="Visual for the quiz question"/>}
        {editing && <><button className="outline" aria-expanded={menu} onClick={() => setMenu(!menu)}>{quiz.image ? 'Change image' : 'Add image'}</button>{menu&&<div className="image-options"><button className="outline" onClick={()=>{setMenu(false);file.current?.click()}}>Upload image</button><button className="outline" onClick={()=>{setMenu(false);setWeb(true)}}>Search web</button></div>}<input ref={file} type="file" accept="image/*" hidden onChange={async e => {
          const picked = e.target.files?.[0]; if (!picked) return;
          const url = URL.createObjectURL(picked);
          try { onChange({...quiz, credit:undefined,image: await quizPicture(url)}); } catch { onError('Could not read that picture.'); } finally { URL.revokeObjectURL(url); }
        }}/></>}</div></div></section><AnswerPane answer={quiz.modelAnswer} editing={editing} onChange={modelAnswer=>onChange({...quiz,modelAnswer})} onError={onError}/></div>
    {quiz.credit&&<a href={quiz.credit} target="_blank" rel="noreferrer">Image source</a>}
    {web&&<QuizImageSearch onClose={()=>setWeb(false)} onPick={(image,credit)=>{onChange({...quiz,image,credit});setWeb(false)}}/>}
    <footer className="draft-footer"><button className="primary" disabled={busy||!quiz.prompt.trim()} onClick={onComplete}>Complete draft</button></footer>
    {live && !shared && <button className="primary" disabled={!quiz.prompt.trim() || sending} onClick={async () => {setSending(true); try {await onShare()} finally {setSending(false)}}}>Share question with class</button>}
    {review && <section className="quiz-answer-list"><h3>Review answers</h3>{quiz.answers?.length ? quiz.answers.map((a,i) => <p key={i}><b>{a.name}</b> {a.answer}</p>) : <p>{shared ? 'Waiting for the first answer.' : 'Answers appear here after you share the question in a live lesson.'}</p>}</section>}
  </section>;
}

export function StudentQuiz({quiz, onSubmit}: {quiz: SlideQuiz & {answered?: boolean}; onSubmit:(answer:string)=>Promise<boolean>}) {
  const [value,setValue] = useState(''), [busy,setBusy] = useState(false), [sent,setSent] = useState(false);
  return <form className="ghost-stage student-quiz" onSubmit={async e=>{e.preventDefault();if(!value.trim()||busy)return;setBusy(true);try{if(await onSubmit(value.trim()))setSent(true)}finally{setBusy(false)}}}>
    <div className="qa-split"><section><h3>Question</h3><div className="ghost-layout"><h2>{quiz.prompt}</h2>{quiz.image&&<img src={quiz.image} alt="Question visual"/>}</div></section><section className="answer-pane"><h3>Answer</h3>
    {sent||quiz.answered ? <p role="status">Answer submitted</p> : <><label>Your answer<textarea required maxLength={2000} value={value} onChange={e=>setValue(e.target.value)}/></label><button className="primary" disabled={busy||!value.trim()}>Submit answer</button></>}
  </section></div></form>;
}
