import type { Slide,SlideElement } from './data';
/** Upgrade legacy slides once in memory; the next edit saves the object layout. */
export function objectSlide(slide:Slide):Slide {
 if(slide.objectLayout)return slide;
 const elements:SlideElement[]=[];
 const text=(source:'title'|'body'|'kicker'|'detail',x:number,y:number,width:number,height:number,fontSize:number,bold=false)=>{if(slide[source])elements.push({id:'base-'+source,kind:'text',source,text:slide[source],x,y,width,height,fontSize,bold,color:'theme'})};
 const background=slide.visual==='uploaded-slide';
 if(background&&slide.image)elements.push({id:'base-image',kind:'image',source:'image',src:slide.image,x:0,y:0,width:100,height:100,color:'theme'});
 else{
 text('kicker',6,5,88,5,13);
 text('title',6,13,88,20,slide.title.length>65?36:44,true);
 text('body',6,36,88,21,23);
 if(slide.image)elements.push({id:'base-image',kind:'image',source:'image',src:slide.image,x:8,y:59,width:84,height:26,color:'theme'});
 else if(slide.visual!=='none')elements.push({id:'base-visual',kind:'visual',text:slide.visual,x:15,y:59,width:70,height:26,color:'theme'});
 text('detail',6,89,88,8,16);
 }
 return {...slide,objectLayout:true,elements:[...elements,...(slide.elements||[])]};
}
