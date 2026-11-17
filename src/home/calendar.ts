import { liveCourses } from "../store";
import { addDeadline, agenda, dateKey, daysUntil, removeDeadline, setDeadlineDone, todayKey, type AgendaItem } from "../deadlines";
import { groupWord } from "../role";
import { esc, reducedMotion } from "../util";
import { canListen, listen, MIC, type Listening } from "../voice";
import { hear, type Heard } from "../voiceDate";

/* The calendar chip on the home screen's top line, for anyone taking notes. One place for everything with a date:
   deadlines you add here, reminders you set from a marker ("remind me Friday"), and a student's exams. */

let month = new Date(); month.setDate(1);
let picked: string | null = null; // a day tapped in the grid: the list and the add form follow it
let landed: string | null = null; // a day something was just said onto: its cell plays the landing once

/* Telling it. The calendar takes a sentence: "bio lab report due next thursday". Hold the calendar chip anywhere on
   the home screen and say it (let go to finish), or tap the mic at the top of the open calendar. The words are read
   by plain rules (src/voiceDate.ts), so the date is exact and nothing is sent anywhere but the browser's own speech
   service; what was understood shows as you speak, and the entry lands on its day with an Undo. If no day was said,
   it asks for one instead of guessing. */
const EXAMPLES = ["“Bio lab report next Thursday”", "“Essay draft due Friday”", "“Midterm on December 3rd”", "“Pay rent on the 1st”", "“Problem set in 3 days”"];
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
function heardHTML(h: Heard | null, live: string, state_: "listening" | "added" | "nodate" | "nothing") {
  const c = h?.courseId ? liveCourses().find(x => x.id === h.courseId) : undefined;
  return `<div class="vheard" data-state="${state_}">
    <p class="vsaid">${live ? esc(live) : state_ === "listening" ? "Listening…" : ""}</p>
    ${h && (h.title || h.date) ? `<div class="vparse"><b>${esc(h.title || "…")}</b>${h.date ? `<span class="vday">${fmtDay(h.date)}</span>` : `<span class="vday none">when?</span>`}${c ? `<span class="vcourse" style="--c:${c.color}">${esc(c.name)}</span>` : ""}</div>` : ""}
    ${state_ === "added" ? `<div class="vdone">Added <button class="linkbtn" data-undo>Undo</button></div>` : state_ === "nodate" ? `<div class="vdone">No day heard: pick one below.</div>` : state_ === "nothing" ? `<div class="vdone">Didn't catch that.</div>` : ""}
  </div>`;
}

const when = (date: string) => { const d = daysUntil(date); return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d > 0 ? (d < 14 ? `in ${d} days` : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : `${-d} days late`; };
const ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.500"/><path d="M2 6.500h12M5.500 1.500v3M10.500 1.500v3"/></svg>`;

/** What still needs doing: not ticked off, today or later, or late. */
const open = (list: AgendaItem[]) => list.filter(x => !x.done && (x.kind === "deadline" || daysUntil(x.date) >= 0));

export function calendarChip(isOpen: boolean): string {
  const all = agenda(), todo = open(all);
  const late = todo.filter(x => daysUntil(x.date) < 0).length;
  const next = todo.find(x => daysUntil(x.date) >= 0) || todo[0];
  const label = next ? `<b class="${daysUntil(next.date) < 0 ? "late" : ""}">${daysUntil(next.date) === 0 ? "Today" : daysUntil(next.date) < 0 ? "Late" : daysUntil(next.date) + "d"}</b><small class="calwhat">${esc(next.title)}</small>` : `<small>Calendar</small>`;
  return `<div class="lbwrap"><button class="chip calchip" id="calBtn" data-popbtn="cal" aria-expanded="${isOpen}" title="${next ? esc(next.title) + " · " + when(next.date) : "Deadlines and reminders"}${late ? ` · ${late} late` : ""}">${ICON}${label}${late ? `<i class="latedot" aria-label="${late} late"></i>` : ""}</button>
    <div class="lbpop calpop" data-pop="cal" ${isOpen ? "" : "hidden"}>${panel(all)}</div></div>`;
}

function panel(all: AgendaItem[]): string {
  const y = month.getFullYear(), mo = month.getMonth(), first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate(), today = todayKey();
  const byDay = new Map<string, AgendaItem[]>();
  for (const x of all) byDay.set(x.date, [...(byDay.get(x.date) || []), x]);
  const cells = [...Array(first)].map(() => `<span></span>`).concat([...Array(days)].map((_, i) => {
    const key = dateKey(new Date(y, mo, i + 1)), items = byDay.get(key) || [];
    return `<button class="cday ${key === today ? "today" : ""} ${key === picked ? "picked" : ""} ${key === landed ? "landed" : ""}" data-day="${key}" aria-pressed="${key === picked}" aria-label="${new Date(y, mo, i + 1).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}">${i + 1}<span class="cdots">${items.slice(0, 3).map(x => `<i style="background:${x.done ? "var(--line)" : x.color}"></i>`).join("")}</span></button>`;
  }));
  const list = picked ? all.filter(x => x.date === picked) : open(all).slice(0, 6);
  const courses = liveCourses();
  const voice = canListen() ? `<button class="vbar" id="calVoice" aria-label="Say a deadline: tap, then say what and when"><span class="vmic">${MIC}</span><span class="vtxt"><b>Say it</b><small>${EXAMPLES[new Date().getDate() % EXAMPLES.length]}</small></span></button><div id="calHeard"></div>` : "";
  return `${voice}<div class="calhead"><h3>${month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3><span><button class="calnav" data-cal="-1" aria-label="Previous month">‹</button><button class="calnav" data-cal="0" title="Back to today">Today</button><button class="calnav" data-cal="1" aria-label="Next month">›</button></span></div>
    <div class="calgrid" role="group" aria-label="Days">${["S", "M", "T", "W", "T", "F", "S"].map(d => `<em>${d}</em>`).join("")}${cells.join("")}</div>
    <h3>${picked ? new Date(`${picked}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Coming up"}</h3>
    <div class="callist">${list.length ? list.map(x => `<div class="crowd ${x.done ? "done" : ""} ${!x.done && daysUntil(x.date) < 0 && x.kind === "deadline" ? "late" : ""}">
        ${x.kind === "deadline" ? `<input type="checkbox" data-done="${x.id}" ${x.done ? "checked" : ""} aria-label="Done: ${esc(x.title)}">` : `<i class="ckind" style="background:${x.color}" title="${x.kind === "exam" ? "Exam" : "Reminder from a marker"}"></i>`}
        ${x.kind === "reminder" ? `<button class="ctitle linkbtn" data-open="${x.noteId}" data-marker="${x.markerId}" title="Open the note this reminder is on">${esc(x.title)}</button>` : `<span class="ctitle">${esc(x.title)}</span>`}
        <small>${picked ? (x.kind === "deadline" ? "" : x.kind) : when(x.date)}</small>
        ${x.kind === "deadline" ? `<button class="cdel" data-del="${x.id}" aria-label="Remove ${esc(x.title)}">×</button>` : ""}</div>`).join("")
      : `<div class="note">${picked ? "Nothing on this day." : "Nothing coming up. Add a deadline below, or tell a marker “remind me Friday”."}</div>`}</div>
    <form class="caladd" id="calAdd"><input id="calTitle" maxlength="120" placeholder="Add a deadline…" aria-label="Deadline" autocomplete="off" required>
      <input type="date" id="calDate" value="${picked || today}" aria-label="Due date" required>
      ${courses.length > 1 ? `<select id="calCourse" aria-label="${groupWord(true)}"><option value="">Any ${groupWord()}</option>${courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>` : ""}
      <button class="btn small primary">Add</button></form>`;
}

/** Wires the open panel. `redraw` re-renders the top line; `openNote` jumps to a reminder's note. */
export function wireCalendar(root: HTMLElement, redraw: () => void, openNote: (noteId: string, markerId?: string) => void) {
  wireHold(root, redraw);
  landed = null;
  const pop = root.querySelector<HTMLElement>(".calpop");
  if (!pop) return;
  const vb = pop.querySelector<HTMLButtonElement>("#calVoice");
  if (vb) vb.onclick = () => {
    if (vb.classList.contains("on")) { talking?.stop(); return; }
    tell(pop.querySelector<HTMLElement>("#calHeard")!, redraw, () => vb.classList.add("on"), () => vb.classList.remove("on"), 1800);
  };
  pop.addEventListener("click", e => e.stopPropagation()); // clicks inside don't close it
  pop.querySelectorAll<HTMLButtonElement>("[data-cal]").forEach(b => b.onclick = () => {
    const step = +b.dataset.cal!;
    if (step) month = new Date(month.getFullYear(), month.getMonth() + step, 1); else { month = new Date(); month.setDate(1); picked = null; }
    redraw();
  });
  pop.querySelectorAll<HTMLButtonElement>("[data-day]").forEach(b => b.onclick = () => { picked = picked === b.dataset.day ? null : b.dataset.day!; redraw(); });
  pop.querySelectorAll<HTMLInputElement>("[data-done]").forEach(c => c.onchange = async () => { await setDeadlineDone(c.dataset.done!, c.checked); redraw(); });
  pop.querySelectorAll<HTMLButtonElement>("[data-del]").forEach(b => b.onclick = async () => { await removeDeadline(b.dataset.del!); redraw(); });
  pop.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => b.onclick = () => openNote(b.dataset.open!, b.dataset.marker));
  const form = pop.querySelector<HTMLFormElement>("#calAdd")!;
  form.onsubmit = async e => {
    e.preventDefault();
    const title = (form.querySelector("#calTitle") as HTMLInputElement).value, date = (form.querySelector("#calDate") as HTMLInputElement).value;
    if (!title.trim() || !date) return;
    await addDeadline(title, date, (form.querySelector("#calCourse") as HTMLSelectElement | null)?.value || null);
    const d = new Date(`${date}T00:00:00`); month = new Date(d.getFullYear(), d.getMonth(), 1); // show the month it landed in
    redraw();
    (document.querySelector("#calTitle") as HTMLInputElement | null)?.focus();
  };
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
        box.innerHTML = heardHTML(h, t, "nodate");
        const title = document.querySelector<HTMLInputElement>("#calTitle"), date = document.querySelector<HTMLInputElement>("#calDate");
        if (title) title.value = h.title;
        const cs = document.querySelector<HTMLSelectElement>("#calCourse"); if (cs && h.courseId) cs.value = h.courseId;
        date?.focus(); (date as HTMLInputElement & { showPicker?: () => void } | null)?.showPicker?.();
        return;
      }
      const id = await addDeadline(h.title, h.date, h.courseId);
      const d = new Date(`${h.date}T00:00:00`); month = new Date(d.getFullYear(), d.getMonth(), 1);
      landed = h.date; picked = null;
      redraw();
      landed = null;
      // the new panel has its own box: show the result there, with Undo
      const box2 = box.isConnected ? box : document.querySelector<HTMLElement>("#calHeard") || holdBubble();
      box2.innerHTML = heardHTML(h, t, "added");
      box2.querySelector<HTMLButtonElement>("[data-undo]")!.onclick = async e => { e.stopPropagation(); if (id) await removeDeadline(id); redraw(); };
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
