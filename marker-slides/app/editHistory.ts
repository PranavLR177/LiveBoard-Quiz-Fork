import type { Slide } from './data';
export class EditHistory {
 private past:Slide[][]=[];private future:Slide[][]=[];private current:Slide[];private lastAt=0;
 constructor(slides:Slide[]){this.current=structuredClone(slides)}
 get canUndo(){return this.past.length>0}get canRedo(){return this.future.length>0}
 record(slides:Slide[],at=Date.now()){
  if(JSON.stringify(slides)===JSON.stringify(this.current))return;
  if(at-this.lastAt>500||!this.past.length){this.past.push(this.current);if(this.past.length>50)this.past.shift()}
  this.current=structuredClone(slides);this.future=[];this.lastAt=at;
 }
 undo(){if(!this.canUndo)return null;this.future.push(this.current);this.current=this.past.pop()!;this.lastAt=0;return structuredClone(this.current)}
 redo(){if(!this.canRedo)return null;this.past.push(this.current);this.current=this.future.pop()!;this.lastAt=0;return structuredClone(this.current)}
}
