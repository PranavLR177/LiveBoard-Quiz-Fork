import { classroomUrl, setRole, type Role } from "../role";
import { applyTheme, isDark, onTheme } from "../theme";

/* Going to the classroom (presentations, live classes, the join screen) from the notes side.
   In the app that is another page on the same address, /classroom.html. The single-file preview can't have a second
   page, so there the classroom is mounted inside this one and the two sides swap in place: it is still one app. */
let showing = false, afterLeave: (() => void) | null = null, stopTheme: (() => void) | null = null;
export const classroomShowing = () => showing;
/** What to do once the notes side is back on screen (the app re-reads the route and redraws). */
export const onClassroomLeave = (fn: () => void) => { afterLeave = fn; };
/** Redraws the notes side after something about it changed from outside (the developer switch). */
export const redrawNotes = () => afterLeave?.();

const notesParts = () => ({ app: document.querySelector<HTMLElement>(".app"), sheets: [...document.querySelectorAll<HTMLStyleElement>("style[data-lb-notes]")] });

export async function openClassroom(view: "teacher" | "student") {
  if (!import.meta.env.VITE_ARTIFACT) { location.assign(classroomUrl(view)); return; }
  const { openClassroom: mount } = await import("../../marker-slides/embed");
  const { app, sheets } = notesParts();
  if (app) app.hidden = true;
  for (const s of sheets) s.disabled = true; // each side styles the whole page, so only one stylesheet is live at a time
  document.querySelectorAll<HTMLElement>(".sheetwrap, .welcome").forEach(x => x.remove());
  const spellOut = () => { document.documentElement.dataset.theme = isDark() ? "dark" : "light"; }; // the classroom wants the theme spelled out
  stopTheme?.(); const off = onTheme(spellOut); stopTheme = () => { off(); }; spellOut();
  showing = true;
  mount(view === "student" ? "?view=student" : "?view=library", (as, hash) => void leaveClassroom(as, hash));
}

export async function leaveClassroom(as?: Role, hash = "") {
  if (!showing) return;
  const { closeClassroom } = await import("../../marker-slides/embed");
  closeClassroom();
  stopTheme?.(); stopTheme = null;
  const { app, sheets } = notesParts();
  for (const s of sheets) s.disabled = false;
  if (app) app.hidden = false;
  applyTheme();
  showing = false;
  if (as) setRole(as);
  if (location.hash !== hash) location.hash = hash; // the route change redraws the notes side
  afterLeave?.();
}
