/* A teacher's classes, through whatever server the classroom is plugged into. Inside LiveBoard that is its own Supabase
   project (src/classroom/classes.ts); the stand-alone classroom has none, and the Classes screen says so. */
export type TeacherClass={id:string;name:string;code:string;students:number;liveRoom:string|null;liveTitle:string|null};
export type RosterRow={userId:string;name:string;joined:string;shares:boolean;notes:number;markers:number;mastered:number;due:number;points:number;lastActive:number|null};
export type StudentWork={notes:{id:string;title:string;kind:string;updated:number;text:string}[];markers:{id:string;noteId:string;type:string;text:string;mastery:number|null;due:number|null;understanding:string|null}[]};
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
};
let backend:ClassesBackend|null=null;
export const setClassesBackend=(b:ClassesBackend|null)=>{backend=b};
export const classesBackend=()=>backend;
