import { course, courseColor, liveCourses, liveMarkers, liveNotes, safeColor } from "../store";
import { groupWord } from "../role";
import { isDue, recallable } from "../study";
import { agoLong, esc, reducedMotion } from "../util";
import type { Course, Note } from "../types";
import { cleanFolder } from "./folderLook";
import { inkOn } from "./folders";

/* All your folders, outside of time. The dial keeps to time (today, this week, last month...); this is the other way
   in, by subject. A small wheel of folder tabs peeks from the right edge of the home screen (the rotunda) and turns
   slowly; a wheel or a drag over it turns it by hand. Tapping it opens a sheet over most of the screen, pulled out
   from the wheel as a widening circle, with every folder you have: each course or notebook, with its own look if you
   gave it one. Tap a folder and it opens in place: its notes, newest first, to open, plus a new note in it. Esc goes
   back a step. */

type H = { openNote: (id: string) => void; newBlank: (courseId: string) => void; editFolder: (courseId: string | null) => void };
let handlers: H | null = null;
let turn = 0; // the wheel's rotation, in degrees, kept between redraws
let openId: string | null = null; // the folder open in the sheet, if any
let query = "";
let keyH: ((e: KeyboardEvent) => void) | null = null;

type Folder = { c: Course; notes: Note[]; last: number; due: number; color: string; ink: string; bg: string; icon: string };
function folders(): Folder[] {
  const dueOf = new Map<string, number>();
  for (const m of liveMarkers()) if (recallable(m) && isDue(m)) dueOf.set(m.noteId, (dueOf.get(m.noteId) || 0) + 1);
  const byCourse = new Map<string, Note[]>();
  for (const n of liveNotes()) byCourse.set(n.courseId, [...(byCourse.get(n.courseId) || []), n]);
  return liveCourses().map(c => {
    const notes = (byCourse.get(c.id) || []).sort((a, b) => b.openedAt - a.openedAt);
    const look = cleanFolder(c.folder), color = safeColor(c.color);
    return { c, notes, last: notes[0]?.openedAt || c.updatedAt || 0, due: notes.reduce((t, n) => t + (dueOf.get(n.id) || 0), 0), color, ink: inkOn(color), bg: look?.bg || "plain", icon: look?.icon || "" };
  }).sort((a, b) => b.last - a.last);
}
const title = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());

/** Draws (or refreshes) the wheel on the right edge. Called with the home screen. */
export function renderRotunda(h: H) {
  handlers = h;
  const fs = folders();
  let wheel = document.querySelector<HTMLButtonElement>("#rotunda");
  if (!fs.length) { wheel?.remove(); return; }
  if (!wheel) {
    wheel = document.createElement("button");
    wheel.id = "rotunda"; wheel.className = "rotunda";
    document.body.appendChild(wheel);
    wireWheel(wheel);
  }
  const shown = fs.slice(0, 10), step = Math.min(30, 150 / Math.max(1, shown.length - 1));
  wheel.setAttribute("aria-label", `All your folders: ${fs.length}`);
  wheel.title = "All your folders";
  wheel.innerHTML = `<span class="rring" style="--turn:${turn}deg">${shown.map((f, i) => {
    const a = 180 + (i - (shown.length - 1) / 2) * step; // fanned around the side facing the screen
    return `<span class="rtab" data-bg="${f.bg}" style="--a:${a}deg;--fc:${f.color};--ft:${f.ink};--i:${i}"><i>${esc(f.icon || title(f.c.name).slice(0, 1))}</i></span>`;
  }).join("")}</span><span class="rhub"><b>${fs.length}</b><small>${fs.length === 1 ? groupWord() : groupWord() + "s"}</small></span>`;
}
export function removeRotunda() { document.querySelector("#rotunda")?.remove(); closeFolders(true); }

function wireWheel(wheel: HTMLButtonElement) {
  const spin = (by: number) => { turn = ((turn + by) % 360 + 360) % 360; wheel.querySelector<HTMLElement>(".rring")?.style.setProperty("--turn", `${turn}deg`); };
  wheel.addEventListener("wheel", e => { e.preventDefault(); spin(e.deltaY * 0.25); wheel.classList.add("spun"); }, { passive: false });
  // dragging up or down turns it; a tap opens the sheet
  let y0: number | null = null, moved = 0;
  wheel.addEventListener("pointerdown", e => { y0 = e.clientY; moved = 0; wheel.setPointerCapture(e.pointerId); });
  wheel.addEventListener("pointermove", e => { if (y0 === null) return; const d = e.clientY - y0; y0 = e.clientY; moved += Math.abs(d); if (moved > 4) { spin(d * 0.8); wheel.classList.add("spun"); } });
  wheel.addEventListener("pointerup", () => { y0 = null; });
  wheel.addEventListener("click", e => { if (moved > 6) { e.preventDefault(); moved = 0; return; } openFolders(); });
}

/* ---------- the sheet ---------- */
export const foldersOpen = () => !!document.querySelector("#folderSheet");

export function openFolders(startIn: string | null = null) {
  closeFolders(true);
  openId = startIn; query = "";
  const back = document.createElement("div");
  back.id = "folderSheet"; back.className = "fsback";
  back.innerHTML = `<section class="fspanel" role="dialog" aria-modal="true" aria-labelledby="fsTitle"></section>`;
  document.body.appendChild(back);
  document.querySelector("#rotunda")?.classList.add("out");
  const panel = back.querySelector<HTMLElement>(".fspanel")!;
  draw(panel, "open");
  back.addEventListener("pointerdown", e => { if (e.target === back) closeFolders(); });
  keyH = e => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (openId && !startIn) { openId = null; draw(panel, "back"); } else closeFolders();
  };
  addEventListener("keydown", keyH, true);
  if (reducedMotion()) return;
  // the sheet widens out of the wheel: a circle centred on it grows to cover the panel
  const w = document.querySelector<HTMLElement>("#rotunda")?.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  const cx = w ? w.left + w.width / 2 - pr.left : pr.width, cy = w ? w.top + w.height / 2 - pr.top : pr.height / 2;
  back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
  panel.animate([{ clipPath: `circle(40px at ${cx}px ${cy}px)` }, { clipPath: `circle(${Math.hypot(pr.width, pr.height) * 1.05}px at ${cx}px ${cy}px)` }], { duration: 640, easing: "cubic-bezier(.7, 0, .2, 1)" });
}

export function closeFolders(now = false) {
  if (keyH) { removeEventListener("keydown", keyH, true); keyH = null; }
  document.querySelector("#rotunda")?.classList.remove("out");
  const back = document.querySelector<HTMLElement>("#folderSheet");
  if (!back) return;
  back.id = "";
  if (now || reducedMotion()) { back.remove(); return; }
  const panel = back.querySelector<HTMLElement>(".fspanel")!, w = document.querySelector<HTMLElement>("#rotunda")?.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  const cx = w ? w.left + w.width / 2 - pr.left : pr.width, cy = w ? w.top + w.height / 2 - pr.top : pr.height / 2;
  back.style.pointerEvents = "none";
  back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, delay: 120, easing: "ease-in", fill: "forwards" });
  panel.animate([{ clipPath: `circle(${Math.hypot(pr.width, pr.height) * 1.05}px at ${cx}px ${cy}px)` }, { clipPath: `circle(36px at ${cx}px ${cy}px)` }], { duration: 460, easing: "cubic-bezier(.6, 0, .3, 1)", fill: "forwards" })
    .finished.then(() => back.remove(), () => back.remove());
}

const ICON_SEARCH = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function folderCard(f: Folder, i: number) {
  const peek = f.notes.slice(0, 3);
  return `<button class="fscard" data-folder="${esc(f.c.id)}" style="--i:${Math.min(i, 24)};--fc:${f.color};--ft:${f.ink}" aria-label="${esc(title(f.c.name))}: ${f.notes.length} note${f.notes.length === 1 ? "" : "s"}${f.due ? `, ${f.due} to recall` : ""}">
    <span class="folder fsf" data-bg="${f.bg}" style="--fc:${f.color};--ft:${f.ink}" aria-hidden="true">
      <span class="fback"><span class="ftab">${f.icon ? `<i>${esc(f.icon)}</i>` : ""}</span></span>
      ${peek.map((n, k) => `<span class="file" style="--c:${courseColor(n.courseId)};--k:${k};z-index:${10 + peek.length - k}"><span class="ft">${esc(n.title || "Untitled")}</span></span>`).join("")}
      <span class="ffront"><b>${esc(title(f.c.name))}</b><span>${f.notes.length ? `${f.notes.length} note${f.notes.length === 1 ? "" : "s"}` : "Empty"}</span></span>
    </span>
    <span class="fsmeta">${f.notes.length ? `opened ${agoLong(f.last)}` : "nothing yet"}${f.due ? `<em>${f.due} to recall</em>` : ""}</span>
  </button>`;
}

function noteCard(n: Note, i: number, f?: Folder) {
  const mk = liveMarkers().filter(m => m.noteId === n.id), due = mk.some(m => recallable(m) && isDue(m));
  return `<button class="fsnote" data-note="${esc(n.id)}" style="--i:${Math.min(i, 30)};--c:${f ? f.color : courseColor(n.courseId)}"><b>${esc(n.title || "Untitled")}</b>
    <span>${agoLong(n.openedAt)}${mk.length ? ` · ${mk.length} marker${mk.length === 1 ? "" : "s"}` : ""}${!f ? ` · ${esc(title(course(n.courseId)?.name || ""))}` : ""}</span>${due ? `<i class="fsdue" title="Markers due for recall"></i>` : ""}</button>`;
}

function draw(panel: HTMLElement, how: "open" | "in" | "back" | "same") {
  const fs = folders(), f = openId ? fs.find(x => x.c.id === openId) : undefined;
  if (openId && !f) openId = null;
  const q = query.trim().toLowerCase();
  if (!f) {
    const hits = fs.filter(x => !q || x.c.name.toLowerCase().includes(q));
    const notes = q ? liveNotes().filter(n => n.title.toLowerCase().includes(q)).sort((a, b) => b.openedAt - a.openedAt).slice(0, 12) : [];
    const total = fs.reduce((t, x) => t + x.notes.length, 0);
    panel.style.removeProperty("--fc");
    panel.innerHTML = `<header class="fshead"><div><h2 id="fsTitle">Your ${groupWord()}s</h2><small>${fs.length} ${fs.length === 1 ? groupWord() : groupWord() + "s"} · ${total} note${total === 1 ? "" : "s"}</small></div>
        <div class="fsacts"><label class="fsfind">${ICON_SEARCH}<input id="fsQ" type="search" placeholder="Find a ${groupWord()} or a note…" autocomplete="off" aria-label="Find a ${groupWord()} or a note" value="${esc(query)}"></label>
        <button class="btn" id="fsNew">New folder</button><button class="rsclose" id="fsClose" aria-label="Close (Esc)">×</button></div></header>
      <div class="fsgrid" id="fsGrid">${hits.map(folderCard).join("") || (q ? "" : `<p class="fsempty">No ${groupWord()}s yet.</p>`)}</div>
      ${notes.length ? `<h3 class="fsh3">Notes matching “${esc(query.trim())}”</h3><div class="fsnotes">${notes.map((n, i) => noteCard(n, i)).join("")}</div>` : q && !hits.length ? `<p class="fsempty">Nothing matches “${esc(query.trim())}”.</p>` : ""}`;
  } else {
    panel.style.setProperty("--fc", f.color);
    panel.innerHTML = `<header class="fshead infolder"><button class="fsback-btn" id="fsBack" aria-label="All ${groupWord()}s">‹ All ${groupWord()}s</button>
        <div class="fstab" data-bg="${f.bg}" style="--fc:${f.color};--ft:${f.ink}"><span>${f.icon ? esc(f.icon) + " " : ""}${esc(title(f.c.name))}</span></div>
        <div class="fsacts"><label class="fsfind">${ICON_SEARCH}<input id="fsQ" type="search" placeholder="Find a note in ${esc(title(f.c.name))}…" autocomplete="off" aria-label="Find a note" value="${esc(query)}"></label>
        <button class="btn primary" id="fsNewNote">New note here</button>
        <button class="btn" id="fsLook" title="${f.c.folder ? "Change its name, colour and look" : "Give it a look and keep it on the dial, left of now"}">${f.c.folder ? "Customize" : "Put on the dial"}</button>
        <button class="rsclose" id="fsClose" aria-label="Close (Esc)">×</button></div></header>
      <h2 id="fsTitle" class="fsinto">${esc(title(f.c.name))}<small>${f.notes.length} note${f.notes.length === 1 ? "" : "s"}${f.due ? ` · ${f.due} to recall` : ""}</small></h2>
      <div class="fsnotes big" id="fsNotes">${(q ? f.notes.filter(n => n.title.toLowerCase().includes(q)) : f.notes).map((n, i) => noteCard(n, i, f)).join("") || `<p class="fsempty">${q ? `No note here matches “${esc(query.trim())}”.` : "Nothing in here yet."}</p>`}</div>`;
  }
  wire(panel);
  if (reducedMotion() || how === "same") return;
  const cards = [...panel.querySelectorAll<HTMLElement>(".fscard, .fsnote")].slice(0, 30);
  if (how === "in") {
    // opening a folder: its notes slide out of it, one after another
    cards.forEach((c, i) => c.animate([{ opacity: 0, transform: "translateY(-26px) rotateX(40deg) scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 40 + i * 28, easing: "cubic-bezier(.2,.9,.3,1.15)", fill: "backwards" }));
    panel.querySelector(".fstab")?.animate([{ transform: "translateY(18px) scale(1.25)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,.9,.3,1.2)" });
  } else {
    // the folders swing in from the wheel's side, as if they'd come off it
    cards.forEach((c, i) => c.animate([{ opacity: 0, transform: "translateX(70px) rotate(10deg) scale(.86)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: (how === "open" ? 220 : 0) + i * 32, easing: "cubic-bezier(.2,.9,.3,1.12)", fill: "backwards" }));
  }
}

function wire(panel: HTMLElement) {
  const h = handlers;
  panel.querySelector<HTMLButtonElement>("#fsClose")!.onclick = () => closeFolders();
  const q = panel.querySelector<HTMLInputElement>("#fsQ");
  if (q) q.oninput = () => { query = q.value; const at = q.selectionStart; draw(panel, "same"); const q2 = panel.querySelector<HTMLInputElement>("#fsQ"); q2?.focus(); if (at !== null) q2?.setSelectionRange(at, at); };
  panel.querySelectorAll<HTMLButtonElement>("[data-folder]").forEach(b => b.onclick = () => {
    openId = b.dataset.folder!; query = "";
    if (reducedMotion()) { draw(panel, "same"); return; }
    // the folder lifts and opens before its notes come out
    b.querySelector(".folder")?.classList.add("open");
    b.animate([{ transform: "none" }, { transform: "translateY(-10px) scale(1.06)" }], { duration: 220, easing: "ease-out", fill: "forwards" }).finished.then(() => draw(panel, "in"), () => draw(panel, "in"));
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-note]").forEach(b => b.onclick = () => { closeFolders(true); h?.openNote(b.dataset.note!); });
  const back = panel.querySelector<HTMLButtonElement>("#fsBack"); if (back) back.onclick = () => { openId = null; query = ""; draw(panel, "back"); };
  const nn = panel.querySelector<HTMLButtonElement>("#fsNewNote"); if (nn && openId) { const id = openId; nn.onclick = () => { closeFolders(true); h?.newBlank(id); }; }
  const look = panel.querySelector<HTMLButtonElement>("#fsLook"); if (look && openId) { const id = openId; look.onclick = () => { closeFolders(true); h?.editFolder(id); }; }
  const nf = panel.querySelector<HTMLButtonElement>("#fsNew"); if (nf) nf.onclick = () => { closeFolders(true); h?.editFolder(null); };
}
