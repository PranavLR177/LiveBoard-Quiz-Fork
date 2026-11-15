import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {EditHistory}=await load('app/editHistory.ts');
const {objectSlide}=await load('app/objectLayout.ts');
const {newLessons}=await load('app/newLessons.ts');
assert.equal(newLessons.length,2);
for(const deck of newLessons){assert.equal(deck.slides.length,5);assert.equal(deck.sampleMarkers.length,10);assert.equal(new Set(deck.sampleMarkers.map(m=>m.kind)).size,3);for(let i=0;i<5;i++){assert.equal(deck.sampleMarkers.filter(m=>m.slide===i).length,2);const original=deck.slides[i],slide=objectSlide(original);assert.equal(slide.elements.find(e=>e.source==='title').text,original.title);assert.equal(slide.elements.find(e=>e.source==='body').text,original.body);assert.equal(slide.elements.find(e=>e.source==='image').src,original.image);assert.equal(objectSlide(slide),slide);assert.equal(original.objectLayout,undefined)}}
const original=newLessons[0].slides;
const history=new EditHistory(original);
const edited=structuredClone(original);edited[0].title='Changed';history.record(edited,1000);
const dragged=structuredClone(edited);dragged[0].body='Dragged';history.record(dragged,1100);
assert.deepEqual(history.undo(),original);assert.deepEqual(history.redo(),dragged);assert.deepEqual(history.undo(),original);
const branch=structuredClone(original);branch[1].title='New edit';history.record(branch,2000);assert.equal(history.canRedo,false);assert.deepEqual(history.undo(),original);assert.equal(original[0].title,'Average versus instantaneous change');
console.log('PASS: all-slide object conversion, 5-slide decks with all marker types, grouped undo/redo, immutable history, new-edit redo reset');
