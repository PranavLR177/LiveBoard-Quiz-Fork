import { useRef, useState } from 'react';

const symbols = [
 ['+','plus addition'], ['−','minus subtraction negative'], ['×','times multiply'], ['÷','divide division'], ['±','plus or minus'], ['≠','not equal'], ['≈','approximately equal'], ['≤','less than or equal'], ['≥','greater than or equal'], ['∞','infinity'], ['√','square root radical'], ['∛','cube root'], ['²','squared exponent'], ['³','cubed exponent'], ['½','half fraction'], ['¼','quarter fraction'], ['¾','three quarters fraction'], ['π','pi'], ['θ','theta angle'], ['Δ','delta change triangle'], ['α','alpha'], ['β','beta'], ['∠','angle geometry'], ['°','degree'], ['⊥','perpendicular'], ['∥','parallel'], ['≅','congruent'], ['∼','similar'], ['→','right arrow approaches'], ['⇌','equilibrium reversible'], ['∑','sigma sum summation'], ['∫','integral calculus'], ['∈','element of set'], ['∪','union'], ['∩','intersection'], ['∅','empty set'], ['·','dot multiply'], ['₂','subscript two chemistry'], ['₁','subscript one'], ['₃','subscript three'], ['⁻','superscript minus'], ['µ','micro'], ['λ','lambda wavelength'], ['∝','proportional']
];
export default function SymbolText({value,onChange,label,maxLength,placeholder}:{value:string;onChange:(s:string)=>void;label:string;maxLength?:number;placeholder?:string}){
 const field=useRef<HTMLTextAreaElement>(null), range=useRef([value.length,value.length]);
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const options=symbols.filter(([s,name])=>(s+' '+name).includes(query.trim().toLowerCase()));
 function insert(symbol:string){
   const [start,end]=range.current;
   const next=value.slice(0,start)+symbol+value.slice(end);
   if(maxLength&&next.length>maxLength)return;
   onChange(next);
   setOpen(false); setQuery('');
   requestAnimationFrame(()=>{field.current?.focus();field.current?.setSelectionRange(start+symbol.length,start+symbol.length)});
 }
 return <div className="symbol-text"><label>{label}<textarea ref={field} maxLength={maxLength} placeholder={placeholder} value={value} onSelect={e=>{range.current=[e.currentTarget.selectionStart,e.currentTarget.selectionEnd]}} onChange={e=>onChange(e.target.value)}/></label>
   <button type="button" className="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>Ω Symbols</button>
   {open&&<div className="symbol-popover"><input autoFocus type="search" aria-label="Search symbols" placeholder="Search symbols, e.g. angle" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div>{options.map(([s,name])=><button type="button" key={s} title={name} aria-label={s+' '+name} onClick={()=>insert(s)}>{s}</button>)}{!options.length&&<small>No matching symbols</small>}</div></div>}
 </div>;
}
