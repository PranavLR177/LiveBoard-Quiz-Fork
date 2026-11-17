import { course, liveCourses, liveMarkers, liveNotes, newCourse, newNote, putCourse } from "../store";
import { addDeadline, agenda, dateKey, daysUntil, planReviews, removeDeadline, setDeadlineDone, todayKey, type AgendaItem } from "../deadlines";
import { getRole, groupWord } from "../role";
import { recallable } from "../study";
import { esc, reducedMotion, toast } from "../util";
import { canListen, listen, MIC, type Listening } from "../voice";
import { hear, type Heard } from "../voiceDate";
import type { EntryKind } from "../types";

/* The calendar. A chip on the home screen's top line says what's next; tapping it opens the calendar over the screen.
   One place for everything with a date: deadlines, exams, events (a class, an appointment, weekly if it repeats),
   study sessions, notes written for a day, reminders set from a marker ("remind me Friday"), and a student's course
   exams.
     The week strip     the next seven days at a glance, with what's on and how much recall is waiting each day.
     The month          every day with its first entries written in, so a busy week is visible from across the room.
     The day            tap any day for what's on it, what you wrote that day, and to add to it: a deadline, an exam,
                        an event or a study session (with a time, and weekly if it repeats), or a note for the day.
                        An exam or deadline a few days off can plan its own reviews: sessions a week, three days and
                        a day before.
   And it can be told things: Say it, or hold the chip on the home screen, and say "chem midterm December 3rd at 2". */

let month = new Date(); month.setDate(1);
let picked = todayKey(); // the day the side panel shows
let landed: string | null = null; // a day something was just added to: its cell plays the landing once
let addKind: EntryKind = "deadline";
let handlers: { redraw: () => void; openNote: (noteId: string, markerId?: string) => void } | null = null;

const EXAMPLES = ["“Bio lab report next Thursday”", "“Chem midterm December 3rd at 2”", "“Study group every Wednesday at 7”", "“Pay rent on the 1st”", "“Problem set in 3 days”"];
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o);
const fmtTime = (t?: string | null) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined }); };
const KIND_LABEL: Record<string, string> = { deadline: "Deadline", exam: "Exam", event: "Event", study: "Study", note: "Note", reminder: "Reminder" };
const when = (date: string) => { const d = daysUntil(date); return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d > 0 ? (d < 14 ? `in ${d} days` : fmtDay(date, { month: "short", day: "numeric" })) : `${-d} days late`; };
const ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.500"/><path d="M2 6.500h12M5.500 1.500v3M10.500 1.500v3"/></svg>`;
const ticks = (x: AgendaItem) => x.own && !x.repeat && x.kind !== "event" && x.kind !== "note"; // things you finish get a box
const kindsHere = (): EntryKind[] => getRole() === "student" ? ["deadline", "exam", "event", "study"] : ["deadline", "event", "study"];

/** What still needs doing: not ticked off, today or later, or late (a late deadline stays until it's ticked). */
const open = (list: AgendaItem[]) => list.filter(x => !x.done && x.kind !== "note" && (daysUntil(x.date) >= 0 || (x.kind === "deadline" && x.own && !x.repeat)));

export function calendarChip(): string {
  const all = agenda(dateKey(new Date(Date.now() + 60 * 864e5))), todo = open(all);
  const late = todo.filter(x => daysUntil(x.date) < 0).length;
  const next = todo.find(x => daysUntil(x.date) >= 0) || todo[0];
  const label = next ? `<b class="${daysUntil(next.date) < 0 ? "late" : ""}">${daysUntil(next.date) === 0 ? "Today" : daysUntil(next.date) < 0 ? "Late" : daysUntil(next.date) + "d"}</b><small class="calwhat">${esc(next.title)}</small>` : `<small>Calendar</small>`;
  return `<div class="lbwrap"><button class="chip calchip" id="calBtn" aria-haspopup="dialog" title="${next ? esc(next.title) + " · " + when(next.date) : "Calendar"}${late ? ` · ${late} late` : ""}">${ICON}${label}${late ? `<i class="latedot" aria-label="${late} late"></i>` : ""}</button></div>`;
}

/* ---------- the open calendar ---------- */
function recallOn(): Map<string, number> {
  const by = new Map<string, number>(), today = todayKey();
  for (const m of liveMarkers()) {
    if (!recallable(m)) continue;
    const k = m.due <= Date.now() ? today : dateKey(new Date(m.due));
    by.set(k, (by.get(k) || 0) + 1);
  }
  return by;
}
function itemRow(x: AgendaItem): string {
  const c = x.courseId ? course(x.courseId) : undefined;
  const opens = x.noteId && (x.kind === "reminder" || x.kind === "note");
  const canPlan = x.own && !x.done && !x.repeat && (x.kind === "exam" || x.kind === "deadline") && daysUntil(x.date) >= 2 || x.id.startsWith("exam:") && daysUntil(x.date) >= 2;
  return `<div class="crow ${x.done ? "done" : ""} ${!x.done && x.own && daysUntil(x.date) < 0 && ticks(x) ? "late" : ""}" style="--c:${x.color}" data-kind="${x.kind}">
    ${ticks(x) ? `<input type="checkbox" data-done="${x.id}" ${x.done ? "checked" : ""} aria-label="Done: ${esc(x.title)}">` : `<i class="ckind" aria-hidden="true"></i>`}
    <span class="cmain">${opens ? `<button class="ctitle linkbtn" data-open="${x.noteId}" ${x.markerId ? `data-marker="${x.markerId}"` : ""} title="Open the note">${esc(x.title)}</button>` : `<span class="ctitle">${esc(x.title)}</span>`}
      <small>${[x.time ? fmtTime(x.time) : "", KIND_LABEL[x.kind] || "", x.repeat ? "every week" : "", c ? c.name : ""].filter(Boolean).map(esc).join(" · ")}</small></span>
    ${canPlan ? `<button class="cplan" data-plan="${x.id}" title="Add review sessions a week, three days and a day before">Plan reviews</button>` : ""}
    ${x.own ? `<button class="cdel" data-del="${x.id}" aria-label="Remove ${esc(x.title)}${x.repeat ? " (every week)" : ""}">×</button>` : ""}</div>`;
}
function draw(sheet: HTMLElement) {
  const today = todayKey(), y = month.getFullYear(), mo = month.getMonth();
  const lastShown = dateKey(new Date(y, mo + 1, 7));
  const all = agenda(lastShown > dateKey(new Date(Date.now() + 8 * 864e5)) ? lastShown : dateKey(new Date(Date.now() + 8 * 864e5)));
  const byDay = new Map<string, AgendaItem[]>();
  for (const x of all) byDay.set(x.date, [...(byDay.get(x.date) || []), x]);
  const recall = recallOn();
  // the week strip
  const week = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return dateKey(d); });
  const strip = week.map((k, i) => {
    const items = (byDay.get(k) || []).filter(x => x.kind !== "note"), r = recall.get(k) || 0;
    return `<button class="cwk ${i === 0 ? "isnow" : ""} ${k === picked ? "picked" : ""}" data-day="${k}" aria-pressed="${k === picked}" aria-label="${fmtDay(k, { weekday: "long", month: "long", day: "numeric" })}: ${items.length} item${items.length === 1 ? "" : "s"}${r ? `, ${r} to recall` : ""}">
      <span class="cwhead"><b>${i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtDay(k, { weekday: "short" })}</b><em>${new Date(`${k}T00:00:00`).getDate()}</em></span>
      <span class="cwitems">${items.slice(0, 3).map(x => `<span class="cwi ${x.done ? "done" : ""}" style="--c:${x.color}" data-kind="${x.kind}">${x.time ? `<u>${esc(fmtTime(x.time))}</u>` : ""}${esc(x.title)}</span>`).join("")}${items.length > 3 ? `<span class="cwmore">+${items.length - 3} more</span>` : ""}${!items.length ? `<span class="cwfree">Free</span>` : ""}</span>
      <span class="cwfoot">${r ? `<span class="cwrec" title="${r} marker${r === 1 ? "" : "s"} to recall">↻ ${r}</span>` : ""}<span class="cwload" style="--n:${Math.min(items.length, 5)}"></span></span></button>`;
  }).join("");
  // the month
  const first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate();
  const cells = [...Array(first)].map(() => `<span class="cpad"></span>`).concat([...Array(days)].map((_, i) => {
    const key = dateKey(new Date(y, mo, i + 1)), items = (byDay.get(key) || []);
    return `<button class="cday ${key === today ? "isnow" : ""} ${key === picked ? "picked" : ""} ${key === landed ? "landed" : ""} ${key < today ? "past" : ""}" data-day="${key}" aria-pressed="${key === picked}" aria-label="${fmtDay(key, { weekday: "long", month: "long", day: "numeric" })}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}">
      <span class="cnum">${i + 1}</span><span class="cchips">${items.slice(0, 2).map(x => `<span class="cchip ${x.done ? "done" : ""}" style="--c:${x.color}">${esc(x.title)}</span>`).join("")}${items.length > 2 ? `<span class="cplus">+${items.length - 2}</span>` : ""}</span>
      <span class="cdots">${items.slice(0, 3).map(x => `<i style="background:${x.done ? "var(--line)" : x.color}"></i>`).join("")}</span></button>`;
  }));
  // the day
  const dayItems = byDay.get(picked) || [], courses = liveCourses();
  const written = liveNotes().filter(n => dateKey(new Date(n.createdAt)) === picked && !dayItems.some(x => x.noteId === n.id)).slice(0, 6);
  const comingUp = open(all).filter(x => x.date > picked).slice(0, 4);
  const kinds = kindsHere(); if (!kinds.includes(addKind)) addKind = "deadline";
  const ph: Record<string, string> = { deadline: "What's due?", exam: "Which exam?", event: "What's happening?", study: "What will you study?" };
  sheet.innerHTML = `<header class="cshead"><div><span class="rskick">Calendar</span><h2 id="calH">${month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2></div>
      <div class="csnav"><button class="calnav" data-cal="-1" aria-label="Previous month">‹</button><button class="calnav" data-cal="0">Today</button><button class="calnav" data-cal="1" aria-label="Next month">›</button>
        ${canListen() ? `<button class="vbar" id="calVoice" aria-label="Say it: tap, then say what and when"><span class="vmic">${MIC}</span><span class="vtxt"><b>Say it</b><small>${EXAMPLES[new Date().getDate() % EXAMPLES.length]}</small></span></button>` : ""}
        <button class="rsclose" id="calClose" aria-label="Close the calendar (Esc)">×</button></div></header>
    <div id="calHeard"></div>
    <div class="cweek" aria-label="The next seven days">${strip}</div>
    <div class="csbody">
      <div class="cmonth"><div class="calgrid" role="group" aria-label="Days">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<em>${d}</em>`).join("")}${cells.join("")}</div></div>
      <aside class="cdaypanel" aria-label="${fmtDay(picked, { weekday: "long", month: "long", day: "numeric" })}">
        <h3>${picked === today ? "Today" : fmtDay(picked, { weekday: "long" })}<small>${fmtDay(picked, { month: "long", day: "numeric" })}${picked !== today ? ` · ${when(picked)}` : ""}</small></h3>
        <div class="callist">${dayItems.length ? dayItems.map(itemRow).join("") : `<p class="cempty">Nothing on this day yet.</p>`}</div>
        ${written.length ? `<h4>Written this day</h4><div class="cwritten">${written.map(n => `<button class="linkbtn" data-open="${n.id}">${esc(n.title || "Untitled note")}</button>`).join("")}</div>` : ""}
        <form class="caladd" id="calAdd">
          <div class="ckinds" role="radiogroup" aria-label="Add a">${kinds.map(k => `<button type="button" role="radio" data-kind="${k}" aria-checked="${k === addKind}">${KIND_LABEL[k]}</button>`).join("")}</div>
          <input id="calTitle" maxlength="120" placeholder="${ph[addKind]}" aria-label="Title" autocomplete="off" required>
          <div class="crowin"><input type="date" id="calDate" value="${picked}" aria-label="Date" required>
            <input type="time" id="calTime" aria-label="Time (optional)" title="Time (optional)">
            ${courses.length > 1 || getRole() === "student" ? `<select id="calCourse" aria-label="${groupWord(true)}"><option value="">${addKind === "exam" ? `Which ${groupWord()}?` : `Any ${groupWord()}`}</option>${courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>` : ""}</div>
          ${addKind === "event" || addKind === "study" ? `<label class="crepeat"><input type="checkbox" id="calRepeat"> Every week</label>` : ""}
          <div class="cacts"><button class="btn primary">Add to ${picked === today ? "today" : fmtDay(picked, { weekday: "short", month: "short", day: "numeric" })}</button>
            <button type="button" class="btn" id="calNote" title="A new note, kept on this day">Write a note for this day</button></div>
        </form>
        ${comingUp.length ? `<h4>After this</h4><div class="callist small">${comingUp.map(x => `<button class="cnext" data-day="${x.date}" style="--c:${x.color}"><i></i><span>${esc(x.title)}</span><small>${when(x.date)}</small></button>`).join("")}</div>` : ""}
      </aside>
    </div>`;
  wire(sheet);
}

function wire(sheet: HTMLElement) {
  const again = () => draw(sheet);
  sheet.querySelector<HTMLButtonElement>("#calClose")!.onclick = () => closeCalendar();
  sheet.querySelectorAll<HTMLButtonElement>("[data-cal]").forEach(b => b.onclick = () => {
    const step = +b.dataset.cal!;
    if (step) month = new Date(month.getFullYear(), month.getMonth() + step, 1); else { month = new Date(); month.setDate(1); picked = todayKey(); }
    again();
  });
  sheet.querySelectorAll<HTMLButtonElement>("[data-day]").forEach(b => b.onclick = () => {
    picked = b.dataset.day!;
    const d = new Date(`${picked}T00:00:00`); if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) month = new Date(d.getFullYear(), d.getMonth(), 1);
    again();
    sheet.querySelector<HTMLElement>(".cdaypanel")?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  });
  sheet.querySelectorAll<HTMLInputElement>("[data-done]").forEach(c => c.onchange = async () => { await setDeadlineDone(c.dataset.done!, c.checked); changed(); again(); });
  sheet.querySelectorAll<HTMLButtonElement>("[data-del]").forEach(b => b.onclick = async () => { await removeDeadline(b.dataset.del!); changed(); again(); });
  sheet.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => b.onclick = () => { const h = handlers; closeCalendar(); h?.openNote(b.dataset.open!, b.dataset.marker); });
  sheet.querySelectorAll<HTMLButtonElement>("[data-plan]").forEach(b => b.onclick = async () => {
    const x = agenda().find(i => i.id === b.dataset.plan); if (!x) return;
    const made = await planReviews(x.title.replace(/ exam$/, "") + (x.kind === "exam" && !/exam/i.test(x.title) ? " exam" : ""), x.date, x.courseId || null);
    toast(made.length ? `Added ${made.length} review session${made.length === 1 ? "" : "s"} before ${x.title}.` : "It's too close to plan reviews before it.", 3600);
    changed(); again();
  });
  sheet.querySelectorAll<HTMLButtonElement>(".ckinds [data-kind]").forEach(b => b.onclick = () => {
    const title = sheet.querySelector<HTMLInputElement>("#calTitle")!.value;
    addKind = b.dataset.kind as EntryKind; again();
    const t = sheet.querySelector<HTMLInputElement>("#calTitle")!; t.value = title; t.focus();
  });
  const form = sheet.querySelector<HTMLFormElement>("#calAdd")!;
  const val = (id: string) => (sheet.querySelector(id) as HTMLInputElement | HTMLSelectElement | null)?.value || "";
  form.onsubmit = async e => {
    e.preventDefault();
    const title = val("#calTitle").trim(), date = val("#calDate") || picked;
    if (!title) return;
    await add({ title, date, courseId: val("#calCourse") || null, kind: addKind, time: val("#calTime") || null, repeat: (sheet.querySelector("#calRepeat") as HTMLInputElement | null)?.checked ? "weekly" : null });
    again();
    sheet.querySelector<HTMLInputElement>("#calTitle")?.focus();
  };
  sheet.querySelector<HTMLButtonElement>("#calNote")!.onclick = async () => {
    const date = val("#calDate") || picked, typed = val("#calTitle").trim();
    let cid = val("#calCourse") || liveCourses()[0]?.id;
    if (!cid) cid = (await newCourse(getRole() === "individual" ? "Personal" : "My first course")).id;
    const n = await newNote(cid, typed || `${fmtDay(date, { weekday: "long", month: "short", day: "numeric" })}`, "blank");
    await addDeadline(n.title, date, cid, { kind: "note", noteId: n.id });
    const h = handlers; closeCalendar(); h?.openNote(n.id);
  };
  const vb = sheet.querySelector<HTMLButtonElement>("#calVoice");
  if (vb) vb.onclick = () => {
    if (vb.classList.contains("on")) { talking?.stop(); return; }
    tell(sheet.querySelector<HTMLElement>("#calHeard")!, () => { if (sheet.isConnected) again(); }, () => vb.classList.add("on"), () => vb.classList.remove("on"), 1800);
  };
}

/** Adds an entry. A student's exam for a course becomes that course's exam date (which drives the exam countdown and
 *  cram); anything else is an entry of its own. Resolves with an undo. */
async function add(e: { title: string; date: string; courseId: string | null; kind: EntryKind; time?: string | null; repeat?: "weekly" | null }): Promise<(() => Promise<void>) | null> {
  const c = e.courseId ? course(e.courseId) : undefined;
  let undo: (() => Promise<void>) | null = null;
  if (e.kind === "exam" && c && getRole() === "student") {
    const before = c.examDate ?? null;
    await putCourse({ ...c, examDate: e.date });
    undo = async () => { const now = course(c.id); if (now) await putCourse({ ...now, examDate: before }); };
  } else {
    const id = await addDeadline(e.title, e.date, e.courseId, { kind: e.kind, time: e.time, repeat: e.repeat });
    if (id) undo = () => removeDeadline(id);
  }
  const d = new Date(`${e.date}T00:00:00`); month = new Date(d.getFullYear(), d.getMonth(), 1);
  picked = e.date; landed = e.date;
  setTimeout(() => { landed = null; }, 50);
  changed();
  return undo;
}
const changed = () => handlers?.redraw();

let escKey: ((e: KeyboardEvent) => void) | null = null;
export function openCalendar() {
  closeCalendar(true);
  picked = picked || todayKey();
  const back = document.createElement("div");
  back.className = "calback"; back.id = "calSheet";
  back.innerHTML = `<section class="calsheet" role="dialog" aria-modal="true" aria-labelledby="calH"></section>`;
  document.body.appendChild(back);
  const sheet = back.querySelector<HTMLElement>(".calsheet")!;
  draw(sheet);
  back.addEventListener("pointerdown", e => { if (e.target === back) closeCalendar(); });
  escKey = e => { if (e.key === "Escape") { e.stopPropagation(); closeCalendar(); } };
  addEventListener("keydown", escKey, true);
  if (!reducedMotion()) {
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    sheet.animate([{ transform: "translateY(24px) scale(.97)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.2,.9,.3,1.1)" });
    sheet.querySelectorAll<HTMLElement>(".cwk").forEach((c, i) => c.animate([{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, delay: 90 + i * 40, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  }
  sheet.querySelector<HTMLElement>(".cwk.today")?.focus({ preventScroll: true });
}
export function closeCalendar(now = false) {
  talking?.cancel(); talking = null;
  if (escKey) { removeEventListener("keydown", escKey, true); escKey = null; }
  const back = document.querySelector<HTMLElement>("#calSheet");
  if (!back) return;
  back.id = "";
  changed();
  if (now || reducedMotion()) { back.remove(); return; }
  back.style.pointerEvents = "none";
  back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" }).finished.then(() => back.remove(), () => back.remove());
}
export const calendarOpen = () => !!document.querySelector("#calSheet");

/** Wires the chip: a tap opens the calendar, holding it listens. `redraw` re-renders the top line. */
export function wireCalendar(root: HTMLElement, redraw: () => void, openNote: (noteId: string, markerId?: string) => void) {
  handlers = { redraw, openNote };
  const chip = root.querySelector<HTMLButtonElement>("#calBtn");
  if (chip) chip.onclick = e => { e.stopPropagation(); openCalendar(); };
  wireHold(root, redraw);
}

/* Telling it, by voice. What's understood shows as you speak (what, when, which course); it's added with an Undo. If
   no day was said it fills in the form and asks for the day, rather than guessing. */
function heardHTML(h: Heard | null, live: string, state_: "listening" | "added" | "nodate" | "nothing") {
  const c = h?.courseId ? liveCourses().find(x => x.id === h.courseId) : undefined;
  return `<div class="vheard" data-state="${state_}">
    <p class="vsaid">${live ? esc(live) : state_ === "listening" ? "Listening…" : ""}</p>
    ${h && (h.title || h.date) ? `<div class="vparse"><b>${esc(h.title || "…")}</b>${h.kind !== "deadline" ? `<span class="vkind">${KIND_LABEL[h.kind]}</span>` : ""}${h.date ? `<span class="vday">${fmtDay(h.date)}${h.time ? " · " + esc(fmtTime(h.time)) : ""}${h.repeat ? " · weekly" : ""}</span>` : `<span class="vday none">when?</span>`}${c ? `<span class="vcourse" style="--c:${c.color}">${esc(c.name)}</span>` : ""}</div>` : ""}
    ${state_ === "added" ? `<div class="vdone">Added <button class="linkbtn" data-undo>Undo</button></div>` : state_ === "nodate" ? `<div class="vdone">No day heard: pick one below.</div>` : state_ === "nothing" ? `<div class="vdone">Didn't catch that.</div>` : ""}
  </div>`;
}

let talking: Listening | null = null;
/** Listens for one sentence and, if it says a day, adds it. `box` shows what's heard; `pause` ends it after a pause. */
function tell(box: HTMLElement, redraw: () => void, start: () => void, end: () => void, pause = 0): Listening | null {
  const courses = liveCourses();
  box.innerHTML = heardHTML(null, "", "listening");
  talking = listen({
    pauseMs: pause,
    onWords: t => { box.innerHTML = heardHTML(hear(t, courses), t, "listening"); },
    onDone: async t => {
      talking = null; end();
      const h = hear(t, courses);
      if (!t.trim() || !h.title) { box.innerHTML = heardHTML(null, t, "nothing"); return; }
      if (!h.date) {
        // no day: fill in what was said and ask for the day
        if (!calendarOpen()) { openCalendar(); box = document.querySelector<HTMLElement>("#calHeard") || box; }
        if (kindsHere().includes(h.kind)) { addKind = h.kind; const s = document.querySelector<HTMLElement>(".calsheet"); if (s) draw(s); box = document.querySelector<HTMLElement>("#calHeard") || box; }
        box.innerHTML = heardHTML(h, t, "nodate");
        const tm = document.querySelector<HTMLInputElement>("#calTime"); if (tm && h.time) tm.value = h.time;
        const title = document.querySelector<HTMLInputElement>("#calTitle"), date = document.querySelector<HTMLInputElement>("#calDate");
        if (title) title.value = h.title;
        const cs = document.querySelector<HTMLSelectElement>("#calCourse"); if (cs && h.courseId) cs.value = h.courseId;
        date?.focus();
        return;
      }
      const undo = await add({ title: h.title, date: h.date, courseId: h.courseId, kind: kindsHere().includes(h.kind) ? h.kind : h.kind === "exam" ? "deadline" : h.kind, time: h.time, repeat: h.repeat });
      redraw();
      // the new panel has its own box: show the result there, with Undo
      const box2 = box.isConnected ? box : document.querySelector<HTMLElement>("#calHeard") || holdBubble();
      box2.innerHTML = heardHTML(h, t, "added");
      box2.querySelector<HTMLButtonElement>("[data-undo]")!.onclick = async e => { e.stopPropagation(); await undo?.(); changed(); box2.innerHTML = ""; redraw(); };
      if (box2.classList.contains("vhold")) setTimeout(() => box2.classList.add("gone"), 5200);
    },
    onError: msg => { talking = null; end(); box.innerHTML = `<div class="vheard" data-state="nothing"><div class="vdone">${esc(msg)}</div></div>`; }
  });
  if (talking) start(); else end();
  return talking;
}

/** The bubble under the calendar chip while the chip is held (and for a moment after, with Undo). */
function holdBubble() {
  let b = document.querySelector<HTMLElement>("#calHold");
  if (!b) { b = document.createElement("div"); b.id = "calHold"; b.className = "vhold"; b.setAttribute("role", "status"); document.body.appendChild(b); }
  b.classList.remove("gone");
  const chip = document.querySelector<HTMLElement>("#calBtn")?.getBoundingClientRect();
  if (chip) { b.style.left = Math.max(8, Math.min(innerWidth - 328, chip.left + chip.width / 2 - 160)) + "px"; b.style.top = chip.bottom + 10 + "px"; }
  return b;
}

/** Hold the calendar chip to talk to it: a short press still opens the calendar. */
function wireHold(root: HTMLElement, redraw: () => void) {
  const chip = root.querySelector<HTMLButtonElement>("#calBtn");
  if (!chip || !canListen() || chip.dataset.hold) return;
  chip.dataset.hold = "1";
  chip.title += " · hold to say a deadline";
  let timer: ReturnType<typeof setTimeout> | null = null, held = false;
  chip.addEventListener("pointerdown", e => {
    if (e.button > 0) return;
    held = false;
    addEventListener("pointerup", up, { once: true });
    addEventListener("pointercancel", up, { once: true });
    timer = setTimeout(() => {
      held = true;
      chip.classList.add("holding");
      if (!reducedMotion()) navigator.vibrate?.(12);
      tell(holdBubble(), redraw, () => {}, () => chip.classList.remove("holding"), 4000); // letting go ends it; a long silence does too
    }, 380);
  });
  // letting go anywhere ends it (the top line can redraw while you hold, replacing the chip under your finger)
  const up = () => { if (timer) clearTimeout(timer); timer = null; if (held) { talking?.stop(); setTimeout(() => { held = false; }, 0); } };
  chip.addEventListener("pointerleave", () => { if (timer && !held) { clearTimeout(timer); timer = null; } });
  chip.addEventListener("contextmenu", e => { if (held) e.preventDefault(); }); // a long press on touch shouldn't open a menu
  // the click that ends a hold isn't a tap: don't open the calendar
  chip.addEventListener("click", e => { if (held) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
