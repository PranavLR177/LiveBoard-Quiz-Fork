/* A teacher's classes, through whatever server the classroom is plugged into. Inside LiveBoard that is its own Supabase
   project (src/classroom/classes.ts); the stand-alone classroom has none, and the Classes screen says so. */
export type TeacherClass={id:string;name:string;code:string;students:number;liveRoom:string|null;liveTitle:string|null};
export type RosterRow={userId:string;name:string;joined:string;shares:boolean;notes:number;markers:number;mastered:number;due:number;points:number;lastActive:number|null};
export type StudentWork={notes:{id:string;title:string;kind:string;updated:number;text:string}[];markers:{id:string;noteId:string;type:string;text:string;mastery:number|null;due:number|null;understanding:string|null}[]};
/** A question: short (answered from memory, self-marked), choice (2 to 6 options, `correct` is the right one's index) or
 *  tf (true or false; `correct` 0 is true, 1 false). `a` is the answer to compare with, or for choice and tf an optional
 *  explanation shown after answering. `img` is an optional small picture (a data: URL). */
export type QuizQuestion={type?:'short'|'choice'|'tf';q:string;a:string;options?:string[];correct?:number;img?:string};
export type TeacherQuiz={id:string;title:string;questions:number;required:boolean;dueAt:string|null;closed:boolean;createdAt:string;done:number;students:number;avgPct:number|null;shuffle?:boolean;items?:QuizQuestion[]};
export type QuizResult={userId:string;name:string;done:boolean;score:number|null;total:number|null;finishedAt:string|null;answers:{got:boolean;said:string;pick?:number}[]};
export type ClassesBackend={
  /** null when nobody is signed in on this device. */
  account():Promise<{email:string}|null>;
  list():Promise<TeacherClass[]>;
  create(name:string,teacher:string):Promise<{id:string;code:string}>;
  rename(id:string,name:string):Promise<void>;
  remove(id:string):Promise<void>;
  roster(id:string):Promise<RosterRow[]>;
  work(classId:string,studentId:string):Promise<StudentWork>;
  /** Ties a live lesson to a class (or unties it with null) so the class's students are told it has started. */
  tieRoom(room:string,secret:string,classId:string|null):Promise<void>;
  /** Pop quizzes: released to every student in the class, taken in their recall, self-graded, one result each. */
  quizzes(classId:string):Promise<TeacherQuiz[]>;
  releaseQuiz(classId:string,title:string,questions:QuizQuestion[],required:boolean,dueAt:string|null,shuffle?:boolean):Promise<string>;
  quizResults(quizId:string):Promise<QuizResult[]>;
  closeQuiz(quizId:string,remove?:boolean):Promise<void>;
};
let backend:ClassesBackend|null=null;
export const setClassesBackend=(b:ClassesBackend|null)=>{backend=b};
export const classesBackend=()=>backend;
