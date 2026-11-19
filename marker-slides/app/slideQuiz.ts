import type { Slide } from './data';

export type QuizAnswer = { name: string; answer: string };
export type ModelAnswer = {text:string;image?:string};
export type SlideQuiz = { modelAnswer?:ModelAnswer; id: string; orientation?: 'horizontal'|'vertical'; credit?: string; prompt: string; image: string; marker?: string; answers?: QuizAnswer[] };
export type RoomQuiz = SlideQuiz & { slide: number; answered?: boolean };

export async function quizPicture(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .75);
}

export async function draftQuiz(slide: Slide, build: boolean, marker?: { id: string; body: string; screenshot?: string }, canvas?: HTMLElement | null): Promise<SlideQuiz> {
  const title = slide.title.replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  const focus = marker?.body.trim();
  const prompt = !build ? '' : focus ? (/\?$/.test(focus) ? focus : 'How would you explain “' + focus + '” using evidence from this slide?')
    : /\?\s*$/.test(slide.body) ? slide.body : 'Using the figure, explain ' + title + ' in your own words. What evidence supports your answer?';
  const source = marker?.screenshot || slide.elements?.find(e => e.kind === 'image')?.src || slide.image;
  let image = source ? await quizPicture(source) : '';
  if (!image && canvas) {
    const { toCanvas } = await import('html-to-image');
    const picture = await toCanvas(canvas, { pixelRatio: 1, skipFonts: true, filter: el => !el.classList?.contains('pin') });
    image = await quizPicture(picture.toDataURL('image/png'));
  }
  return { id: crypto.randomUUID(), prompt, image, marker: marker?.id };
}
