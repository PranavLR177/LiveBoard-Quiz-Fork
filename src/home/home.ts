import { courseColor, courseName, liveCourses, liveMarkers, liveNotes, note, putMeta, putLocalMeta, state, streak, course } from "../store";
import { leaderboard, currentUser } from "../sync";
import type { Course, Marker, Note } from "../types";
import { $, agoLong, DAY, dayKey, esc, H, reducedMotion, toast, wrapDeg } from "../util";
import { canListen, hush, listen, MIC, say, type Listening } from "../voice";
import { setPendingOpen, TYPE_INFO } from "../editor/markerBox";
import { aiHealth, askMarker } from "../ai";
import { compareAnswer, fingerprint, forecast, gradeMarker, isDue, recallable, recallText, studiedOn, upcomingExams } from "../study";
import { renderSky } from "./sky";
import { closeMap, openMap } from "./map";
import { pulse, recolor, startBezel, stopBezel } from "./bezel";
import { openCram } from "./cram";
import { onTheme } from "../theme";
import { closeShelf, openShelf } from "./shelf";
import { calendarChip, closeCalendar, wireCalendar } from "./calendar";
import { onQuizChange, pendingQuizzes, sendQuiz } from "./liveNotice";
import { getRole, groupWord } from "../role";
import { cleanFolder } from "./folderLook";
import { inkOn as folderInk, openFolderEditor } from "./folders";

/* The home screen: a morning strip over a spinning dial of notes arranged by when they were last opened.
   Recall plays inside the dial's center while the ring turns to each question's note. */

type Band = { l: string; s: string; max: number; w: number };
// The ring runs clockwise from "now" at the pointer. Everything older than two months shares one folder whose
// name follows what's in it (Months ago, A year ago, Years ago), so the ring never fills with tiny folders.
const BANDS: Band[] = [
  { l: "Recently opened", s: "last 24 hours", max: DAY, w: 2.6 },
  { l: "This week", s: "1–7 days", max: 7 * DAY, w: 1.9 },
  { l: "This month", s: "1–4 weeks", max: 31 * DAY, w: 1.35 },
  { l: "Last month", s: "1–2 months", max: 62 * DAY, w: 1.1 },
  { l: "In the past", s: "2+ months", max: Infinity, w: 1.05 }
];
const FOLDC: [string, string][] = [["--g1", "#fff"], ["--g2", "#2B1500"], ["--g3", "#2A2100"], ["--g4", "#032E2A"], ["--g5", "#fff"], ["--g6", "#fff"], ["--g7", "#fff"]];
const GAPDEG = 5, SAMEGAP = 1.5, MAXFILES = 5, LOOSE = 3;
/** Folders you made (a course or notebook with a look of its own) sit just left of the pointer, outside the run of
 *  time: from YOURS_FROM degrees round to the pointer. Spin back from "now" and they come round. */
const MINE: Band = { l: "Your folders", s: "made by you", max: -1, w: 1.2 };
const YOURS_FROM = 262, MAX_YOURS = 6;
/** The last thing on the ring, just past the oldest folder: an empty folder that makes a new one of your own. */
const ADD: Band = { l: "New folder", s: "make your own", max: -2, w: 0.8 };
/** A folder's colour and the ink on it: its own colour for one you made, the band's colour for a time folder. */
const fcOf = (f: Item): [string, string] => f.add ? ["var(--muted)", "#fff"] : f.custom ? [courseColor(f.custom.id), folderInk(courseColor(f.custom.id))] : (([v, ink]) => [`var(${v})`, ink])(FOLDC[BANDS.indexOf(f.b) % FOLDC.length]);
/** Where the oldest folder ends, in degrees clockwise from the pointer: about 3/4 of the way round, leaving the
 *  last quarter empty so the start and end of time never sit next to each other. */
const ARC_END = 258;

interface Item { b: Band; label: string; ns: Note[]; w: number; loose?: boolean; more?: boolean; custom?: Course; add?: boolean; span: number; ang: number; W: number; x: number; y: number; near: number; tilt: number }
/** One recall session. `typed` is what the student wrote from memory for the current question; `missed` collects the ones answered "Again". */
interface Recall { queue: string[]; i: number; revealed: boolean; got: number; done: boolean; k: number; typed: string; missed: string[]; cram: string | null; ai: string | null; checking: boolean; flipped?: boolean; results: boolean[]; spoke?: boolean; quiz?: QuizRun }
/** A teacher's pop quiz being taken: its questions, the student's marks and words so far, and how sending went. */
interface QuizRun { id: string; title: string; className: string; teacher: string; required: boolean; items: { q: string; a: string }[]; answers: { got: boolean; said: string }[]; sent: { score: number; total: number } | null; error: string }

let items: Item[] = [];
let rot = 0, target = 0, sel = -1, hoverF = -1, hoverNote: string | null = null, dragging = false, lastDrawn: number | null = null, raf = 0;
let G: { c: number; rF: number; hub: number; push: number; els: HTMLElement[]; turn: HTMLElement[] } = { c: 0, rF: 0, hub: 0, push: 0, els: [], turn: [] };
let R: Recall | null = null;
let focusNote: string | null = null;
/** Which morning-strip popover is open: "lb" (leaderboard), "fc" (forecast) or "exam:<courseId>". */
let pop: string | null = null;
let aiOn = false;
aiHealth().then(h => { aiOn = h.ai; });
let handlers: { openNote: (id: string) => void; newBlank: (courseId?: string) => void; importFile: () => void; openSettings: (section?: string) => void } | null = null;
let alive = false;
onTheme(() => recolor($("#dial"))); // light or dark: the bezel re-reads its ink
let introduced = false; // the 3D rise plays once per launch, not every time you come back to the dial
let three = false;      // while it plays, cards float above the tilted dial and keep facing you
let swipeNext = false;  // the next note opens with the page swiping away (set by the marker cards under the dial)
/** True once, right after a marker card asked for the swipe. */
export const takeSwipe = () => { const s = swipeNext; swipeNext = false; return s; };
let pendingRecall: { ids: string[]; label: string } | null = null; // a quiz to start as soon as the dial is up (the exit ticket)
let diving = false;     // a note is dropping into the hub: the dial stops responding until the page opens
const off: (() => void)[] = [];

export const setFocusNote = (id: string | null) => { focusNote = id; };

/* ---------- recall queue ---------- */
const hasDue = (noteId: string) => liveMarkers().some(m => m.noteId === noteId && isDue(m) && recallable(m));
function curCourseId() {
  const n = note(focusNote) || [...liveNotes()].sort((a, b) => b.openedAt - a.openedAt)[0];
  return n?.courseId || null;
}
function inScope(m: Marker) {
  const age = Date.now() - m.createdAt;
  if (m.type === "reminder" && m.remindAt && m.remindAt <= Date.now()) return true;
  if (state.meta.scope === "due") return true;
  if (state.meta.scope === "night") return age < 36 * H;
  if (state.meta.scope === "week") return age < 7 * DAY;
  return note(m.noteId)?.courseId === curCourseId();
}
const queue = () => liveMarkers().filter(m => isDue(m) && recallable(m) && inScope(m)).sort((a, b) => a.due - b.due).slice(0, 20);
const doneToday = () => state.meta.studyDays.includes(dayKey(Date.now()));

/* ---------- morning strip ---------- */
const ring = (pct: number, color: string, cls = "") => `<span class="ering ${cls}" style="--p:${pct};--c:${color}"></span>`;
const inDays = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

async function renderMorning() {
  const el = $("#morning");
  if (!el) return;
  const hr = new Date().getHours();
  const greet = (hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening") + (state.meta.displayName ? `, ${state.meta.displayName.split(" ")[0]}` : "");
  const q = queue(), st = streak();
  const cid = curCourseId();
  const overdue = q.filter(m => m.due < Date.now() - DAY).length;
  const wk = [...Array(7)].map((_, i) => { const back = 6 - i, k = dayKey(Date.now() - back * DAY); return `<i class="${state.meta.studyDays.includes(k) ? "on" : ""} ${back === 0 ? "today" : ""}"></i>`; }).join("");
  const c = course(cid);
  const fc = forecast(), fcMax = Math.max(1, ...fc.map(d => d.n));
  const student = getRole() === "student"; // exams, cram and classes are school things; everyone gets the calendar
  const exams = student ? upcomingExams().slice(0, 2) : [];
  // The greeting and what's waiting are the heading. Everything else sits quietly either side of it on one line:
  // the streak to the left, exams and class to the right. Where you recall from is a word in the sentence.
  const scopeWord = { due: "everything due", night: "last night", week: "this week", unit: courseName(cid) }[state.meta.scope];
  const scopePick = `<span class="lbwrap"><button class="scopebtn" id="scopeBtn" data-popbtn="scope" aria-expanded="${pop === "scope"}" title="Choose what to recall from">${esc(scopeWord)}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="lbpop scopepop" data-pop="scope" ${pop === "scope" ? "" : "hidden"}><h3>Recall from</h3><div class="scope" role="group" aria-label="Recall from">${(["due", "night", "week", "unit"] as const).map(s => `<button data-s="${s}" aria-pressed="${s === state.meta.scope}">${{ due: "Everything due", night: "Last night", week: "This week", unit: "This course" }[s]}</button>`).join("")}</div></div></span>`;
  const line = q.length ? `<b class="qn">${q.length}</b> marker${q.length > 1 ? "s" : ""} to recall from ${scopePick}${overdue ? `<span class="od">${overdue} overdue</span>` : ""}`
    : doneToday() && state.meta.scope === "due" ? `Today's recall is done · ${scopePick}` : `Nothing due from ${scopePick}`;
  el.innerHTML = `<div class="mside left"><div class="lbwrap"><button class="chip streakchip" data-popbtn="fc" aria-expanded="${pop === "fc"}" title="Study streak: days you finished a recall. Tap for what's coming up."><b>${st}</b><small>day streak</small><span class="wk" aria-hidden="true">${wk}</span></button>
      <div class="lbpop fcpop" data-pop="fc" ${pop === "fc" ? "" : "hidden"}><h3>Coming up · next 7 days</h3>
        <div class="fcbars">${fc.map((d, i) => `<div class="fcd ${i === 0 ? "today" : ""}" title="${d.n} marker${d.n === 1 ? "" : "s"} due ${i === 0 ? "today" : d.day.toLocaleDateString(undefined, { weekday: "long" })}"><b>${d.n || ""}</b><i style="height:${d.n ? Math.max(8, Math.round(56 * d.n / fcMax)) : 3}px"></i><small>${i === 0 ? "Today" : d.day.toLocaleDateString(undefined, { weekday: "narrow" })}</small></div>`).join("")}</div>
        <div class="note">${studiedOn(Date.now()) ? "Today is done. " : ""}Each time you get one right, it comes back later: a day, then a few days, then a week.</div></div></div></div>
    <div class="mhead"><h1 class="greet">${esc(greet)}</h1>
      <div class="msub"><span class="mline">${line}</span></div></div>
    <div class="mside right">${calendarChip()}${exams.map((x, xi) => {
      const left = x.counts[0] + x.counts[1];
      return `<div class="lbwrap ${xi ? "later" : ""}"><button class="chip examchip" data-popbtn="exam:${x.courseId}" aria-expanded="${pop === "exam:" + x.courseId}" title="${esc(x.name)} exam ${inDays(x.days)} · ${x.pct}% ready">${ring(x.pct, x.color)}<b>${x.days === 0 ? "Today" : x.days + "d"}</b><small>${esc(x.name)}</small></button>
      <div class="lbpop exampop" data-pop="exam:${x.courseId}" ${pop === "exam:" + x.courseId ? "" : "hidden"}><h3>${esc(x.name)} exam · ${inDays(x.days)}</h3>
        ${x.markers.length ? `<div class="ebig">${ring(x.pct, x.color, "big")}<span class="epct"><b>${x.pct}%</b>ready</span>
          <div class="ebars">${(["Unsure", "Getting it", "Mastered"] as const).map((l, i) => `<div><span>${l}</span><i><u style="width:${Math.round(100 * x.counts[i] / x.markers.length)}%;background:${i === 2 ? "var(--good)" : i ? x.color : "var(--line)"}"></u></i><b>${x.counts[i]}</b></div>`).join("")}</div></div>
          <button class="recallbtn cram" data-cram="${x.courseId}" data-tip="${left ? "Opens a cram sitting: your weak spots, plus extra questions written from your notes." : "Everything here is mastered. One more pass won't hurt."}">Cram for this exam <span class="cnt">${left || x.markers.length}</span></button>`
        : `<button class="recallbtn cram" data-cram="${x.courseId}" data-tip="No markers in ${esc(x.name)} yet. Cram can still write practice questions from the notes themselves.">Cram from your notes</button>`}</div></div>`;
    }).join("")}
    ${!student ? "" : `<div class="lbwrap" id="lbWrap">${c?.classId && currentUser()
      ? `<button class="chip lbchip" id="lbBtn" data-popbtn="lb" aria-expanded="${pop === "lb"}" aria-controls="lbPop"><span class="lbico" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="6" cy="5.5" r="2.4" fill="currentColor"/><path d="M1.6 13c.3-2.5 2-3.9 4.4-3.9s4.1 1.4 4.4 3.9z" fill="currentColor"/><circle cx="11.6" cy="6.2" r="1.8" fill="currentColor" opacity=".6"/><path d="M11 9.4c2 .1 3.2 1.3 3.5 3.6h-2.6" fill="currentColor" opacity=".6"/></svg></span><b id="lbRank">#–</b><small>in ${esc(c.name)}</small></button><div class="lbpop" id="lbPop" data-pop="lb" ${pop === "lb" ? "" : "hidden"}><h3>${esc(c.name)} · this week</h3><div id="lbRows">Loading…</div></div>`
      : `<button class="chip lbchip" id="lbJoin" title="Join your class to see its leaderboard"><span class="lbico" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="6" cy="5.5" r="2.4" fill="currentColor"/><path d="M1.6 13c.3-2.5 2-3.9 4.4-3.9s4.1 1.4 4.4 3.9z" fill="currentColor"/><circle cx="11.6" cy="6.2" r="1.8" fill="currentColor" opacity=".6"/><path d="M11 9.4c2 .1 3.2 1.3 3.5 3.6h-2.6" fill="currentColor" opacity=".6"/></svg></span><small>Classes</small><svg class="lbgo" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`}</div>`}</div>`;
  el.querySelectorAll<HTMLButtonElement>(".scope button").forEach(b => b.onclick = async e => { e.stopPropagation(); pop = null; await putLocalMeta({ scope: b.dataset.s as "due" }); renderMorning(); });
  renderSlip(q.length, overdue);
  el.querySelectorAll<HTMLButtonElement>("[data-popbtn]").forEach(b => b.onclick = e => {
    e.stopPropagation(); setPop(b.dataset.popbtn!);
    if (pop === "cal") void renderMorning(); // drawn fresh each time it opens: a deadline may have arrived from another device
  });
  // cramming is a longer sitting than daily recall, so it opens its own screen (cram.ts)
  el.querySelectorAll<HTMLButtonElement>("[data-cram]").forEach(b => b.onclick = () => {
    closePop();
    openCram({ courseId: b.dataset.cram!, openNote: (noteId, markerId) => { if (markerId) setPendingOpen(markerId); handlers?.openNote(noteId); }, onClose: () => { if (alive && $("#dial") && handlers) renderHome($("#stage")!, handlers, true); } });
  });
  wireCalendar(el, renderMorning, (noteId, markerId) => { closePop(); if (markerId) setPendingOpen(markerId); handlers?.openNote(noteId); });
  const join = $("#lbJoin");
  if (join) join.onclick = () => { location.hash = "classes"; };
  if ($("#lbBtn") && c?.classId) {
    const rows = await leaderboard(c.classId);
    if (!alive || !$("#lbRows")) return;
    if (!rows) { $("#lbRows")!.textContent = "Couldn't load the leaderboard."; return; }
    const me = rows.findIndex(r => r.is_me);
    $("#lbRank")!.textContent = me >= 0 ? `#${me + 1}` : "#–";
    $("#lbRows")!.innerHTML = rows.map((r, i) => `<div class="br ${r.is_me ? "me" : ""}"><span class="n">${i + 1}</span><span>${esc(r.display_name)}</span><span class="p">${r.points} pts</span></div>`).join("") + `<div class="note">Points come from recall answers this week.</div>`;
  }
}
/** Open one morning-strip popover (or close it if it's the one already open). */
function setPop(next: string | null) {
  pop = pop === next ? null : next;
  document.querySelectorAll<HTMLElement>("#morning [data-pop]").forEach(x => { x.hidden = x.dataset.pop !== pop; });
  document.querySelectorAll<HTMLElement>("#morning [data-popbtn]").forEach(b => b.setAttribute("aria-expanded", String(b.dataset.popbtn === pop)));
}
const closePop = () => { if (pop) setPop(null); };

/* ---------- Follow a thought: the markers you touched most recently ---------- */
function renderFollow() {
  const el = $("#follow");
  if (!el) return;
  const all = liveMarkers().filter(m => !m.closedAt); // closed-out markers live in the map, not on the home page
  const recent = [...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  if (!recent.length) {
    el.innerHTML = `<div class="followhead"><h2>Follow a thought.</h2></div><p class="followempty">Markers you place show up here, so you can pick a thought back up from anywhere.</p>`;
    return;
  }
  el.innerHTML = `<div class="followhead"><h2>Follow a thought.</h2><span>${all.length} living point${all.length === 1 ? "" : "s"} in your notes</span>
      ${all.filter(m => !m.detachedAt).length >= 2 ? `<button class="mapopen" id="mapOpen" title="See every marker and how you're doing overall">Open your map<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}</div>
    <div class="sky" id="sky"></div>
    <div class="fcards">${recent.map(m => {
      const n = note(m.noteId);
      const saved = m.thread.filter(t => t.role !== "user").length + (m.draft?.trim() ? 1 : 0);
      return `<button class="fcard" data-m="${m.id}" data-type="${m.type}">
        <span class="fpath"><i class="fdot" data-mastery="${m.mastery}"></i>${esc(courseName(n?.courseId))} / ${esc(n?.title || "")}</span>
        <span class="ftext">${m.text ? esc(m.text.length > 140 ? m.text.slice(0, 140) + "…" : m.text) : `<em>A blank point · ${esc(TYPE_INFO[m.type].label.toLowerCase())}</em>`}</span>
        <span class="fmeta">${saved} saved item${saved === 1 ? "" : "s"} · ${agoLong(m.updatedAt)} · <b>Open marker ↗</b></span></button>`;
    }).join("")}</div>`;
  const openMarker = (id: string, swipe = false) => {
    const m = state.markers.get(id);
    if (!m) return;
    hidePeek(true);
    setPendingOpen(m.id);
    swipeNext = swipe;
    handlers?.openNote(m.noteId);
  };
  el.querySelectorAll<HTMLButtonElement>(".fcard").forEach(b => {
    b.onclick = () => openMarker(b.dataset.m!, true);
    // resting on a card shows a peek of what's inside the marker; the peek is clickable too
    b.addEventListener("pointerenter", e => { if (e.pointerType !== "touch") showPeek(b, id => openMarker(id, true)); });
    b.addEventListener("pointerleave", e => { if (e.pointerType !== "touch") hidePeek(); });
    // touch has no resting: press and hold shows the same peek (a plain tap still opens the marker). It stays until you
    // tap it (opens) or tap anywhere else (puts it away).
    let hold = 0, held = false, hx = 0, hy = 0;
    const drop = () => { clearTimeout(hold); hold = 0; };
    b.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      held = false; hx = e.clientX; hy = e.clientY;
      hold = window.setTimeout(() => {
        held = true;
        navigator.vibrate?.(8);
        showPeek(b, id => openMarker(id, true), 0);
        const away = (ev: PointerEvent) => { if ((ev.target as Element).closest("#fpeek")) return; document.removeEventListener("pointerdown", away, true); hidePeek(true); };
        setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
      }, 430);
    });
    b.addEventListener("pointermove", e => { if (hold && Math.hypot(e.clientX - hx, e.clientY - hy) > 8) drop(); });
    b.addEventListener("pointerup", drop);
    b.addEventListener("pointercancel", drop);
    b.addEventListener("contextmenu", e => { if (held) e.preventDefault(); });
    b.addEventListener("click", e => { if (held) { held = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    b.addEventListener("focus", () => { if (b.matches(":focus-visible")) showPeek(b, id => openMarker(id, true), 0); });
    b.addEventListener("blur", () => hidePeek());
  });
  const sky = $("#sky")!;
  renderSky(sky, openMarker);
  // the chart is a doorway: tap its background (or the button) and it opens into the full learning map
  const showMap = () => openMap({ from: sky.hidden ? null : sky, openMarker, streak: streak() });
  sky.addEventListener("click", e => { if (!(e.target as Element).closest(".star")) showMap(); });
  const mo = $("#mapOpen");
  if (mo) mo.onclick = showMap;
}

/* ---------- dial ---------- */
function pastLabel(ns: Note[]) {
  const ages = ns.map(n => Date.now() - n.openedAt), young = Math.min(...ages), old = Math.max(...ages);
  if (old < 365 * DAY) return "Months ago";
  if (young >= 730 * DAY) return "Years ago";
  if (young >= 365 * DAY && old < 730 * DAY) return "A year ago";
  return "In the past";
}
/** Your own folders, oldest first, so the newest one sits nearest the pointer. */
export const yourFolders = () => liveCourses().filter(c => cleanFolder(c.folder)).sort((a, b) => (cleanFolder(a.folder)!.at - cleanFolder(b.folder)!.at) || a.name.localeCompare(b.name)).slice(-MAX_YOURS);
function layout() {
  const notes = liveNotes().sort((a, b) => b.openedAt - a.openedAt);
  const mine = yourFolders(), inMine = new Set(mine.map(c => c.id));
  const out: Omit<Item, "span" | "ang" | "W" | "x" | "y" | "near" | "tilt">[] = [];
  BANDS.forEach((b, bi) => {
    const lo = bi ? BANDS[bi - 1].max : -Infinity;
    // a note in one of your folders lives there; it only also shows as one of the three loose recent cards
    const ns = notes.filter(n => { const age = Date.now() - n.openedAt; return age >= lo && age < b.max; }).filter((n, k) => !inMine.has(n.courseId) || (bi === 0 && k < LOOSE));
    if (!ns.length) return;
    if (bi === 0) {
      ns.slice(0, LOOSE).forEach(n => out.push({ b, label: b.l, ns: [n], w: b.w, loose: true }));
      if (ns.length > LOOSE) out.push({ b, label: b.l, ns: ns.slice(LOOSE), w: 1.25, more: true });
    } else out.push({ b, label: b.max === Infinity ? pastLabel(ns) : b.l, ns, w: b.w });
  });
  out.push({ b: ADD, label: ADD.l, ns: [], w: ADD.w, add: true }); // packs after "In the past", the end of time
  for (const c of mine) out.push({ b: MINE, label: c.name, ns: notes.filter(n => n.courseId === c.id), w: MINE.w, custom: c });
  // Angles depend on the dial's size, so sizeDial() places them.
  items = out.map(f => ({ ...f, span: 0, ang: 0, W: 0, x: 0, y: 0, near: 0, tilt: 0 }));
}

/** How big each item is next to the newest note: recent work is drawn largest and every step back in time shrinks. */
const SIZE = [1, 0.8, 0.71, 0.63, 0.56], MORE_SIZE = 0.84;
/** How far each item reaches over the center circle, as a share of its width: most at the top, fading to none at
 *  the bottom so folders never cover the hub's Import and Blank page buttons. */
const OVERLAP = 0.14;
/** A folder holding a lot grows a little (on a log scale, so 300 notes is not 30 times 10): it reads as fuller without
 *  ever outgrowing the cards for more recent work by much. Loose cards are one note each and never change. */
const volume = (f: Item) => f.loose ? 1 : 1 + Math.min(0.2, Math.log10(Math.max(1, f.ns.length)) * 0.085);
const sizeOf = (f: Item) => (f.add ? 0.5 : f.custom ? 0.72 : f.more ? MORE_SIZE : SIZE[BANDS.indexOf(f.b)] ?? SIZE[SIZE.length - 1]) * volume(f);
/** 0–3: how thick a folder's stack is drawn. */
const stack = (n: number) => n > 80 ? 3 : n > 20 ? 2 : n > MAXFILES ? 1 : 0;
const compact = (n: number) => n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
/** Distance from the dial's center to an item's center when it sits at `deg` (0 = the pointer). */
function radiusAt(W: number, deg: number, folder: boolean) {
  const t = deg * Math.PI / 180, cos = Math.cos(t);
  const inward = (W * 0.74 * Math.abs(cos) + W * Math.abs(Math.sin(t))) / 2;
  const tuck = OVERLAP * W * (1 + cos) / 2, peek = folder ? 0.2 * W * Math.max(0, -cos) : 0; // files peek out of a folder's top
  return G.hub / 2 + inward + peek - tuck;
}

/** Packs items clockwise from the pointer by their real size: neighbours in the same band touch, and any room
 *  left before ARC_END goes into the gaps between bands, so recent notes stay bunched near the top and older
 *  folders step down the right side and round the bottom. Shrinks everything if it would run past ARC_END. */
function placeItems(maxW: number) {
  const half = (f: Item, deg: number) => {
    const t = deg * Math.PI / 180, foot = f.W * Math.abs(Math.cos(t)) + f.W * 0.74 * Math.abs(Math.sin(t));
    return Math.asin(Math.min(1, foot / 2 / radiusAt(f.W, deg, !f.loose))) * 180 / Math.PI;
  };
  const time = items.filter(f => !f.custom), mine = items.filter(f => f.custom);
  // Your folders first: packed backwards from just left of the pointer, shrinking until they fit in their quarter.
  let arcEnd = ARC_END;
  if (mine.length) {
    const head = time.length ? half({ ...time[0], W: Math.max(64, maxW * sizeOf(time[0])) } as Item, 0) : 0;
    let k = 1, start = 0;
    for (;;) {
      mine.forEach(f => { f.W = Math.max(56, maxW * sizeOf(f) * k); });
      let a = 360 - head - GAPDEG;
      for (let m = mine.length - 1; m >= 0; m--) {
        const f = mine[m], h = half(f, a - half(f, a));
        f.ang = a - h; f.span = 2 * h; a = f.ang - h - SAMEGAP;
      }
      start = mine[0].ang - mine[0].span / 2;
      if (start >= YOURS_FROM || k <= 0.62) break;
      k *= 0.92;
    }
    if (start < YOURS_FROM) { const top = mine[mine.length - 1].ang, s2 = (top - YOURS_FROM - mine[0].span / 2) / (top - mine[0].ang || 1); mine.forEach(f => { f.ang = top - (top - f.ang) * s2; }); start = YOURS_FROM; }
    arcEnd = Math.min(ARC_END, start - 3 * GAPDEG);
  }
  const pack = () => {
    let a = 0;
    const ends: number[] = [];
    time.forEach((f, i) => {
      if (i) {
        const p = time[i - 1], gap = p.b === f.b ? SAMEGAP : GAPDEG;
        const h1 = half(p, p.ang), guess = p.ang + h1 + gap + half(f, p.ang + h1);
        a = p.ang + h1 + gap + half(f, guess);
      }
      f.ang = a; f.span = 2 * half(f, a);
      ends.push(a + f.span / 2);
    });
    return ends.length ? ends[ends.length - 1] : 0;
  };
  // Shrink a little if the ring is full, but never so much that recent notes stop being readable;
  // past that, neighbours overlap slightly instead (the one under the pointer always comes to the front).
  let scale = 1, end = 0;
  for (;;) {
    time.forEach(f => { f.W = Math.max(64, maxW * sizeOf(f) * scale); });
    end = pack();
    if (end <= arcEnd || scale <= 0.86) break;
    scale *= 0.95;
  }
  if (time.length < 2) return;
  if (end > arcEnd) { const k = arcEnd / end; time.forEach(f => { f.ang *= k; }); return; }
  const breaks = time.reduce((t, f, i) => t + (i && time[i - 1].b !== f.b ? 1 : 0), 0);
  if (!breaks) return;
  let shift = 0;
  time.forEach((f, i) => { if (i && time[i - 1].b !== f.b) shift += (arcEnd - end) / breaks; f.ang += shift; });
}

function itemHTML(f: Item, i: number) {
  if (f.custom) return mineHTML(f, i);
  if (f.add) return `<div class="folder addf" data-f="${i}" style="--i:${i}"><button class="addbtn" tabindex="-1" aria-label="New folder: make a folder of your own" title="New folder"><svg viewBox="0 0 64 52" aria-hidden="true"><path class="addshape" d="M4 10a5 5 0 0 1 5-5h14l5 6h27a5 5 0 0 1 5 5v27a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path class="addplus" d="M32 20v16M24 28h16"/></svg><span>New folder</span></button></div>`;
  const fc = FOLDC[BANDS.indexOf(f.b) % FOLDC.length];
  if (f.loose) {
    const n = f.ns[0], mc = liveMarkers().filter(x => x.noteId === n.id).length;
    return `<div class="folder loose" data-f="${i}" style="--fc:var(${fc[0]});--i:${i};--lz:${(1.25 - (i % 3) * 0.2).toFixed(2)}">
      <button class="file solo" data-n="${n.id}" tabindex="-1" style="--c:${courseColor(n.courseId)};--k:0" aria-label="${esc(courseName(n.courseId) + ", " + n.title)}">
        <span class="fc"><span class="dot" style="background:${courseColor(n.courseId)}"></span>${esc(courseName(n.courseId))}</span>
        <span class="ft">${esc(n.title)}</span>${fingerprint(n.id, 10)}<span class="fm">${agoLong(n.openedAt)} · ${mc} marker${mc === 1 ? "" : "s"}</span>${hasDue(n.id) ? '<span class="md"></span>' : ""}</button></div>`;
  }
  const show = f.ns.slice(0, MAXFILES), m = show.length;
  const big = f.ns.length > MAXFILES;
  return `<div class="folder" data-f="${i}" data-vol="${stack(f.ns.length)}" style="--fc:var(${fc[0]});--ft:${fc[1]};--i:${i};--lz:${(0.55 + (i % 4) * 0.17).toFixed(2)}">
    <div class="fback"><span class="ftab"></span></div>
    ${show.map((n, k) => `<button class="file" data-n="${n.id}" tabindex="-1" style="--c:${courseColor(n.courseId)};--k:${k};z-index:${10 + m - k}" aria-label="${esc(courseName(n.courseId) + ", " + n.title)}"><span class="ft">${esc(n.title)}</span><span class="fm">${esc(courseName(n.courseId))} · ${agoLong(n.openedAt)}</span>${hasDue(n.id) ? '<span class="md"></span>' : ""}</button>`).join("")}
    <div class="ffront"><b>${f.more ? `+${compact(f.ns.length)} more` : f.label}</b>${big ? `<span class="seeall" data-all="${i}" title="See all ${f.ns.length} notes">See all ${compact(f.ns.length)}</span>` : `<span>${f.more ? "recently opened" : `${f.ns.length} note${f.ns.length > 1 ? "s" : ""}`}</span>`}</div></div>`;
}

/** Makes or changes one of your folders, then redraws the dial turned to it. */
function editFolder(courseId: string | null) {
  openFolderEditor(courseId, id => {
    if (!alive || !handlers || !$("#dial")) return;
    renderHome($("#stage")!, handlers, true, true);
    const k = id ? items.findIndex(f => f.custom?.id === id) : -1;
    if (k >= 0) goTo(k);
  });
}

/** A folder you made: your colour, background and mark, with your name on the front. An empty one still shows. */
function mineHTML(f: Item, i: number) {
  const look = cleanFolder(f.custom!.folder)!, [col, ink] = fcOf(f), show = f.ns.slice(0, MAXFILES), m = show.length, big = f.ns.length > MAXFILES;
  return `<div class="folder mine" data-f="${i}" data-bg="${look.bg}" data-vol="${stack(f.ns.length)}" style="--fc:${col};--ft:${ink};--i:${i};--lz:${(0.55 + (i % 4) * 0.17).toFixed(2)}">
    <div class="fback"><span class="ftab">${look.icon ? `<i>${esc(look.icon)}</i>` : ""}</span></div>
    ${show.map((n, k) => `<button class="file" data-n="${n.id}" tabindex="-1" style="--c:${courseColor(n.courseId)};--k:${k};z-index:${10 + m - k}" aria-label="${esc(f.label + ", " + n.title)}"><span class="ft">${esc(n.title)}</span><span class="fm">${agoLong(n.openedAt)}</span>${hasDue(n.id) ? '<span class="md"></span>' : ""}</button>`).join("")}
    <div class="ffront"><b>${esc(titleCase(f.label))}</b>${big ? `<span class="seeall" data-all="${i}" title="See all ${f.ns.length} notes">See all ${compact(f.ns.length)}</span>` : `<span>${f.ns.length ? `${f.ns.length} note${f.ns.length > 1 ? "s" : ""}` : "Empty"}</span>`}</div></div>`;
}
const titleCase = (t: string) => t.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());

/** `keep` re-renders in place (same rotation). `still` skips the spin-in, for when the dial is morphing back from a note. */
let quizWanted: string | null = null; // "Take it" on a quiz card while away from home: started once home is drawn
/** The next dial plays the first-look rise again, as on a fresh launch (switching sides). */
export const replayIntro = () => { introduced = false; };
addEventListener("lb-role-switched", replayIntro); // the developer side switch (src/devSwitch.ts)
let enteringUntil = 0, redrawLater: ReturnType<typeof setTimeout> | null = null;

export function renderHome(stage: HTMLElement, h: NonNullable<typeof handlers>, keep = false, still = false) {
  // A quiet redraw (data arriving, a sync) mid-entrance would cut the animation off: let it finish, then redraw.
  if (keep && Date.now() < enteringUntil && stage.querySelector("#dial")) {
    if (redrawLater) clearTimeout(redrawLater);
    redrawLater = setTimeout(() => { redrawLater = null; if (alive && stage.querySelector("#dial")) renderHome(stage, handlers ?? h, true); }, enteringUntil - Date.now() + 30);
    return;
  }
  if (redrawLater) { clearTimeout(redrawLater); redrawLater = null; }
  handlers = h;
  alive = true;
  if (quizWanted) { const id = quizWanted; quizWanted = null; setTimeout(() => { if (alive && !startQuiz(id)) toast("That quiz is already done."); }, 450); }
  layout();
  const prevRot = rot, prevTarget = target;
  stage.innerHTML = `<div class="dialwrap"><div class="morning" id="morning"></div>
    <div id="dial" tabindex="0" role="group" aria-roledescription="dial" aria-label="Your notes, arranged by when you last opened them. Use the arrow keys to spin and Enter to open.">
      <div class="dialgrid" aria-hidden="true"></div><div class="dialglow" aria-hidden="true"></div><div class="ringline" id="ringline"></div><div id="folders"></div>
      <div class="hub" id="hub"><div class="hubring" id="hubring" aria-hidden="true"></div><div class="hubticks" id="hubticks" aria-hidden="true"></div><svg class="hubprog" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
        <div class="info" id="info" aria-live="polite"></div>
        <div class="hubacts">
          <button class="hbtn" data-act="import" title="${getRole() === "individual" ? "Import a file" : "Import lecture"}" aria-label="${getRole() === "individual" ? "Import a file" : "Import lecture"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg><span>Import</span></button>
          <button class="hbtn" data-act="blank" title="Blank page" aria-label="Blank page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/></svg><span>Blank page</span></button>
</div></div></div>
    <div id="infoSlot"></div>
    <div class="spinrow"><button class="spinbtn" id="spinPrev" aria-label="Spin toward newer notes">←</button><span class="spinhint"><span class="hov">Drag or scroll to move through time · select a folder to peek inside</span><span class="tch">Drag the dial to move through time · tap a folder to bring it up and open it</span></span><button class="spinbtn" id="spinNext" aria-label="Spin toward older notes">→</button></div>
    <section class="follow" id="follow"></section></div>`;
  $("#folders")!.innerHTML = items.map(itemHTML).join("");
  $("#hub")!.querySelectorAll<HTMLButtonElement>(".hbtn").forEach(b => b.onclick = () => (b.dataset.act === "blank" ? h.newBlank() : h.importFile()));
  renderMorning();
  renderFollow();
  $("#spinPrev")!.onclick = () => goTo(sel - 1);
  $("#spinNext")!.onclick = () => goTo(sel + 1);
  sel = -1; hoverF = -1; hoverNote = null;
  sizeDial();
  bindDial();
  { // the dial's moving parts: bezel ticks, time dust and the light under the pointer (see bezel.ts)
    const dialEl = $("#dial")!, hubNow = $("#hub")!;
    startBezel(dialEl, () => rot, () => (G ? { size: G.c * 2, rF: G.rF, hubR: (hubNow.offsetWidth || G.hub) / 2 } : { size: 0, rF: 0, hubR: 0 }));
  }
  if (keep) { rot = prevRot; target = prevTarget; }
  else {
    let k = items.findIndex(f => f.ns.some(n => n.id === focusNote));
    if (k < 0) k = 0;
    target = items.length ? -items[k].ang : 0;
    rot = reducedMotion() || still ? target : target + 60;
    if (!reducedMotion() && !still) {
      const d = $("#dial")!;
      d.classList.add("enter"); setTimeout(() => d.classList.remove("enter"), 1400);
      enteringUntil = Date.now() + (introduced ? 1400 : 1900);
      if (!introduced) {
        // First look: the dial lies edge-on in a faint grid with its notes hovering over it, then swings up to face you.
        three = true;
        d.classList.add("intro3d");
        setTimeout(() => { three = false; d.classList.remove("intro3d"); lastDrawn = null; if (alive && d.isConnected) paint(); }, 1900);
      }
    }
    introduced = true;
    if (pendingRecall) setTimeout(() => { if (alive) runPendingRecall(); }, 420);
  }
  lastDrawn = null;
  if (!items.some(f => !f.add)) $("#info")!.innerHTML = `<div class="infoin"><span class="pill" style="background:var(--g5)">Start here</span><div class="htitle">${getRole() === "individual" ? "Import a file or start a blank page" : "Import a lecture or start a blank page"}</div></div>`;
  cancelAnimationFrame(raf);
  if (items.length) { draw(); lastDrawn = rot; } // placed before the first frame, so a morph from the note page lands on the card
  raf = requestAnimationFrame(loop);
}
/** Opening a note from the dial: its card tips and drops into the hub, the hub opens, and the view follows it in
 *  until the hub's light fills the screen. Resolves with `land`, to call once the note page is drawn: it lifts the
 *  cover so the page settles into place. Returns null when there's nothing to animate (reduced motion, card off screen). */
export function diveInto(noteId: string): Promise<() => void> | null {
  const card = cardFor(noteId), dial = $("#dial"), hub = $("#hub"), st = $("#stage");
  if (!card || !dial || !hub || !st || diving || three || reducedMotion() || document.visibilityState !== "visible" || !card.animate) return null;
  const cr = card.getBoundingClientRect(), hr = hub.getBoundingClientRect();
  if (cr.width < 8 || cr.bottom < 40 || cr.top > innerHeight - 40) return null;
  diving = true;
  const folder = card.closest<HTMLElement>(".folder")!;
  const s = cr.width / (card.offsetWidth || cr.width) || 1;
  const dx = (hr.left + hr.width / 2 - (cr.left + cr.width / 2)) / s, dy = (hr.top + hr.height / 2 - (cr.top + cr.height / 2)) / s;
  folder.style.zIndex = "600";
  card.style.zIndex = "99";
  st.style.overflow = "hidden";
  dial.classList.add("diving");
  $(".dialwrap")?.classList.add("diving");
  const fill = "forwards" as const;
  card.animate([
    { translate: "0 0", scale: "1", rotate: "x 0deg", opacity: 1 },
    { translate: "0 -0.9em", scale: "1.07", rotate: "x 0deg", opacity: 1, offset: 0.3, easing: "cubic-bezier(.55, 0, .85, .35)" },
    { translate: `${dx}px ${dy}px`, scale: "0.1", rotate: "x 62deg", opacity: 1, offset: 0.9 },
    { translate: `${dx}px ${dy}px`, scale: "0.04", rotate: "x 70deg", opacity: 0 }
  ], { duration: 430, fill });
  // the camera: the whole dial rushes toward the viewer, centred on the hub, whose inside brightens to the page colour
  const reach = Math.hypot(Math.max(hr.left + hr.width / 2, innerWidth - hr.left - hr.width / 2), Math.max(hr.top + hr.height / 2, innerHeight - hr.top - hr.height / 2));
  const zoom = Math.min(26, (reach / (hr.width / 2)) * 1.25);
  const cam = dial.animate([{ scale: "1" }, { scale: String(zoom) }], { duration: 400, delay: 250, easing: "cubic-bezier(.7, 0, .84, .3)", fill });
  return cam.finished.then(() => {
    const cover = document.createElement("div");
    cover.className = "divecover";
    document.body.appendChild(cover);
    diving = false;
    st.style.overflow = "";
    return () => {
      const done = () => cover.remove();
      cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-out", fill }).finished.then(done, done);
      document.querySelector<HTMLElement>(".paper")?.classList.add("landing");
    };
  }, () => { diving = false; st.style.overflow = ""; return () => {}; });
}
/** The card (or file in a folder) that stands for a note on the dial, for the open and close morph. */
export const cardFor = (noteId: string) => document.querySelector<HTMLElement>(`#folders .file[data-n="${CSS.escape(noteId)}"]`);

export function destroyHome() {
  alive = false;
  stopBezel();
  hidePeek(true);
  closeMap(true);
  closeShelf(true);
  diving = false; three = false;
  cancelAnimationFrame(raf);
  off.splice(0).forEach(f => f());
  if (R) closeSheet(true);
  closeCalendar(true);
  R = null;
  pop = null;
  document.querySelector("#recallSlip")?.remove();
}

const RISE = 0.34; // share of a fanned folder's height kept clear above the dial; the rest may rise over the tucked top line
const TUCK = 0.74; // how small the top line is drawn while tucked away (styles.css uses the same number as --tuck)
function sizeDial() {
  const st = $("#stage")!, dial = $("#dial");
  if (!dial) return;
  // The dial is the screen. The top line is tucked (drawn at TUCK of its size until you go to it), and the row under
  // the dial is small, so the dial gets nearly all the height.
  const morning = $("#morning")!;
  morning.style.setProperty("--mh", morning.offsetHeight + "px");
  const w = st.clientWidth - 32, h = st.clientHeight - morning.offsetHeight * TUCK - 54;
  const mw = (sz: number) => Math.max(120, Math.min(250, sz * 0.33));
  const rise = (W: number) => (W / 13) * (1.6 + (MAXFILES - 1) * 2) - W * 0.74 * 0.16;
  let size = Math.max(300, Math.min(w, 940));
  if (w >= 560) size = Math.max(320, Math.min(size, h - rise(mw(size)) * RISE));
  const maxW = mw(size), c = size / 2;
  const rF = c - 10 - maxW * 0.42, hub = Math.max(120, 2 * (rF - maxW * 0.3));
  dial.style.marginTop = Math.max(0, rise(maxW) * RISE) + "px";
  dial.style.setProperty("--size", size + "px");
  dial.style.setProperty("--hub", hub + "px");
  const ring = $("#ringline")!;
  ring.style.width = ring.style.height = 2 * rF + "px";
  // notes away from the pointer sit a little outside the ring, so they don't crowd the hub or the selected note
  G = { c, rF, hub, push: Math.max(14, Math.min(46, size * 0.06)), els: [...document.querySelectorAll<HTMLElement>("#folders .folder")], turn: [$("#hubring")!, $("#hubticks")!] };
  placeItems(maxW);
  paintRing();
  items.forEach((f, i) => {
    const el = G.els[i];
    el.style.setProperty("--W", f.W + "px");
    el.classList.toggle("small", f.loose ? f.W < 100 : f.W < 140);
    el.classList.toggle("mini", f.W < 78);
  });
  placeInfo();
  dial.classList.toggle("tight", hub < 300);
  lastDrawn = null;
}

/** The note details and recall questions sit inside the hub when it's big enough, and in a card under the dial when
 *  it isn't (phones). On mid-size dials the hub grows during recall instead, so the question stays in the center. */
function placeInfo() {
  const info = $("#info"), hubEl = $("#hub"), slot = $("#infoSlot");
  if (!info || !hubEl || !slot) return;
  const compact = G.hub < 210;
  $("#dial")?.classList.toggle("tiny", compact);
  if (compact && info.parentElement !== slot) slot.appendChild(info);
  else if (!compact && info.parentElement !== hubEl) hubEl.insertBefore(info, hubEl.querySelector(".hubacts"));
}

/** The ring around the hub is the time scale: each stretch takes the color of the note or folder that sits
 *  in that direction, and it turns with the dial. The quarter past the oldest folder stays plain. */
function paintRing() {
  const el = $("#hubring");
  if (!el) return;
  if (!items.length) { el.style.removeProperty("--ring"); return; }
  // Quiet by default: every stretch is the same soft grey with a hairline gap between bands, so the ring still shows
  // how time is divided. Only the stretch under the pointer is lit, in that note's or folder's colour.
  const col = (f: Item, i: number) => i !== sel ? "var(--ringmute)" : (f.loose ? courseColor(f.ns[0].courseId) : fcOf(f)[0]);
  const h0 = items[0].span / 2, last = items[items.length - 1], end = Math.min(last.ang + last.span / 2, 350 - h0), gap = 1.1;
  const stops = [`${col(items[0], 0)} 0deg`, `${col(items[0], 0)} ${(h0 - gap).toFixed(1)}deg`, `transparent ${(h0 - gap).toFixed(1)}deg`, `transparent ${h0.toFixed(1)}deg`];
  items.slice(1).forEach((f, j) => {
    const from = Math.max(h0, f.ang - f.span / 2), to = Math.min(end, f.ang + f.span / 2);
    stops.push(`${col(f, j + 1)} ${from.toFixed(1)}deg`, `${col(f, j + 1)} ${(to - gap).toFixed(1)}deg`, `transparent ${(to - gap).toFixed(1)}deg`, `transparent ${to.toFixed(1)}deg`);
  });
  if (items.length > 1) stops.push(`transparent ${(end + 8).toFixed(1)}deg`, `transparent ${(352 - h0).toFixed(1)}deg`);
  stops.push(`transparent ${(360 - h0).toFixed(1)}deg`, `${col(items[0], 0)} ${(360 - h0 + gap).toFixed(1)}deg`, `${col(items[0], 0)} 360deg`);
  el.style.setProperty("--ring", `conic-gradient(${stops.join(", ")})`);
}

function draw() {
  const { c } = G;
  let best = 0, bd = 999;
  items.forEach((f, i) => {
    const a = f.ang + rot, d = wrapDeg(a), t = a * Math.PI / 180;
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = i; }
    const r = radiusAt(f.W, d, !f.loose);
    f.x = c + r * Math.sin(t); f.y = c - r * Math.cos(t); f.near = Math.max(0, 1 - Math.abs(d) / 90);
    f.tilt = Math.sin(t) * 3.5; // cards lean a little as they travel round, upright at the top and bottom
  });
  G.turn.forEach(e => { e.style.transform = `rotate(${rot.toFixed(2)}deg)`; });
  if (best !== sel) {
    const first = sel < 0;
    sel = best;
    updateInfo();
    paintRing(); // the lit stretch follows the pointer
    if (!first) pulse();
    if (!first && dragging && !reducedMotion()) navigator.vibrate?.(4); // a small detent as each note passes the top
  }
  paint();
}
function paint() {
  if (diving) return;
  const rk = R && !R.done ? R.k : -1;
  // during the 3D rise each card floats off the dial (a little differently per card) and turns back to face the viewer
  const face = three ? " translateZ(calc(var(--lift) * var(--lz))) rotateY(calc(var(--ry) * -1)) rotateX(calc(var(--rx) * -1))" : "";
  items.forEach((f, i) => {
    const el = G.els[i];
    if (!el) return;
    const open = rk >= 0 ? i === rk : i === sel || i === hoverF;
    const grow = f.loose ? (open ? 1.06 : 1) : open ? Math.min(rk >= 0 ? 1.3 : 9, Math.max(1.04, f.W < 150 ? 150 / f.W : 1)) : 1;
    const sc = (0.92 + 0.08 * f.near) * grow;
    el.style.transform = `translate(${f.x}px,${f.y}px) translate(-50%,-50%)${face} rotate(${open ? 0 : f.tilt.toFixed(2)}deg) scale(${sc})`;
    el.style.zIndex = String(i === hoverF ? 400 : open ? 250 : Math.round(100 + f.near * 50));
    el.style.opacity = String(rk >= 0 ? (i === rk ? 1 : 0.28) : open || f.loose ? 1 : (0.7 + 0.3 * f.near).toFixed(2));
    el.classList.toggle("open", open);
  });
}
function loop() {
  if (!alive || !$("#dial")) return;
  if (!dragging) { const d = target - rot; rot = Math.abs(d) < 0.03 ? target : rot + d * (reducedMotion() ? 1 : 0.14); }
  if (rot !== lastDrawn) { draw(); lastDrawn = rot; }
  raf = requestAnimationFrame(loop);
}
const snapFrom = (r: number) => {
  if (!items.length) return r;
  let bk = 0, bd = 999;
  items.forEach((f, k) => { const d = Math.abs(wrapDeg(f.ang + r)); if (d < bd) { bd = d; bk = k; } });
  return r - wrapDeg(items[bk].ang + r);
};
const goTo = (k: number) => { if (!items.length) return; k = ((k % items.length) + items.length) % items.length; target = rot - wrapDeg(items[k].ang + rot); };


/** Dark text on light course colors (yellow, mint), white on dark ones, so labels stay readable. */
function inkOn(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#1B1638" : "#fff";
}
function setHc(v: string, el: HTMLElement) { [$("#dial"), el].forEach(x => { x?.style.setProperty("--hc", v); x?.style.setProperty("--hcink", inkOn(v)); }); recolor($("#dial")); }
function updateInfo() {
  if (R) return;
  const el = $("#info"), fi = hoverF >= 0 ? hoverF : sel, f = items[fi];
  if (!el || !f) return;
  const n = hoverNote ? note(hoverNote) : f.loose ? f.ns[0] : null;
  const fc = fcOf(f);
  const key = n ? n.id : "f" + fi;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  let html: string;
  if (n) {
    const ms = liveMarkers().filter(m => m.noteId === n.id), due = ms.filter(m => isDue(m) && recallable(m)).length, mastered = ms.filter(m => m.mastery === 2).length;
    const ago = agoLong(n.openedAt), num = (ago.match(/^[\d.]+/) || [""])[0], lab = num ? ago.slice(num.length).trim() : "opened";
    setHc(courseColor(n.courseId), el);
    html = `<span class="pill" style="background:${courseColor(n.courseId)}" title="${esc(f.more ? "More recent" : f.label)}">${esc(courseName(n.courseId))}</span>
      <div class="htitle">${esc(n.title)}</div>${fingerprint(n.id, 18)}
      <div class="stats"><span class="stat"><b>${num || "Now"}</b>${esc(lab)}</span><span class="stat" title="${mastered} mastered"><b>${ms.length}</b>marker${ms.length === 1 ? "" : "s"}</span>${due ? `<span class="stat due"><b>${due}</b>to recall</span>` : ""}</div>
      <button class="openlink">Open note</button>`;
  } else if (f.add) {
    setHc("var(--muted)", el);
    html = `<span class="pill addpill">New folder</span><div class="htitle">A folder of your own</div>
      <div class="note">Give it a name, a colour and a look. It sits left of now on the dial, and holds every note you put in it.</div>
      <button class="openlink" id="hubMake">Make a folder</button>`;
  } else if (f.custom) {
    // one of your folders: what's in it, and the ways to fill it or change how it looks
    setHc(fc[0], el);
    const look = cleanFolder(f.custom.folder)!;
    html = `<span class="pill" style="background:${fc[0]};color:${fc[1]}">${look.icon ? esc(look.icon) + " " : ""}${esc(titleCase(f.label))}</span>
      <div class="bignum" style="--a:${fc[0]}">${f.ns.length}<small>note${f.ns.length === 1 ? "" : "s"}</small></div>
      ${f.ns.length ? `<button class="openlink">Open newest</button>` : `<div class="note mineempty">Empty. Start a note here, or move one in from the ${groupWord()} menu at the top of a note.</div>`}
      <div class="minebtns"><button class="alllink" id="hubNewIn">+ New note here</button><button class="alllink" id="hubLook">Customize</button>${f.ns.length > MAXFILES ? `<button class="alllink" id="hubAll">See all ${compact(f.ns.length)}</button>` : ""}</div>`;
  } else {
    setHc(fc[0], el);
    const cs = [...new Set(f.ns.map(x => x.courseId))];
    html = `<span class="pill" style="background:${fc[0]};color:${fc[1]}">${f.more ? "More recent" : f.label}</span>
      <div class="bignum" style="--a:${fc[0]}">${f.ns.length}<small>note${f.ns.length > 1 ? "s" : ""}</small></div>
      <div class="cdots">${cs.slice(0, 8).map(c => `<span title="${esc(courseName(c))}" style="background:${courseColor(c)}"></span>`).join("")}<em>${cs.length} course${cs.length > 1 ? "s" : ""}</em></div>
      <button class="openlink">Open newest</button>${f.ns.length > MAXFILES ? `<button class="alllink" id="hubAll">See all ${compact(f.ns.length)}</button>` : ""}`;
  }
  el.innerHTML = `<div class="infoin">${html}</div>`;
  const openBtn = el.querySelector<HTMLButtonElement>(".openlink");
  if (openBtn) openBtn.onclick = () => f.add ? editFolder(null) : handlers?.openNote((n || f.ns[0]).id);
  if (f.custom && !n) {
    const cid = f.custom.id;
    el.querySelector<HTMLButtonElement>("#hubNewIn")!.onclick = () => handlers?.newBlank(cid);
    el.querySelector<HTMLButtonElement>("#hubLook")!.onclick = () => editFolder(cid);
  }
  const allBtn = el.querySelector<HTMLButtonElement>("#hubAll");
  if (allBtn) allBtn.onclick = () => showShelf(fi);
}
/* ---------- The peek: hover a marker card under the dial to see inside it before opening ---------- */
let peekTimer = 0, peekFor: string | null = null;
const plain = (t: string) => t.replace(/^✎\s*/, "").replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
function showPeek(card: HTMLElement, open: (id: string) => void, delay = 170) {
  clearTimeout(peekTimer);
  const id = card.dataset.m!;
  if (peekFor === id && $("#fpeek")) return;
  peekTimer = window.setTimeout(() => {
    const m = state.markers.get(id);
    if (!m || !card.isConnected) return;
    $("#fpeek")?.remove();
    peekFor = id;
    const n = note(m.noteId);
    const kept = m.thread.filter(t => t.role !== "user");
    const lastMsg = kept[kept.length - 1];
    const inside = m.draft?.trim() ? { tag: "Draft in progress", text: plain(m.draft) } : lastMsg ? { tag: lastMsg.calc ? "Worked out" : lastMsg.role === "self" ? "You wrote" : "Marker said", text: lastMsg.calc ? `${lastMsg.calc} = ${lastMsg.result ?? ""}` : plain(lastMsg.text) } : null;
    const asked = m.thread.filter(t => t.role === "user").length, links = (m.links?.length || 0) + (m.linkNoteId ? 1 : 0);
    const when = m.recallOff ? "not in recall" : m.due <= Date.now() ? "due for recall now" : "next recall " + new Date(m.due).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const p = document.createElement("div");
    p.id = "fpeek"; p.className = "fpeek"; p.dataset.type = m.type;
    p.setAttribute("role", "button"); p.setAttribute("aria-label", "Open this marker");
    p.innerHTML = `<div class="ptop"><span class="ptype"><i></i>${esc(TYPE_INFO[m.type].label)}</span><span class="pmast" data-mastery="${m.mastery}"><i></i>${["Unsure", "Getting it", "Mastered"][m.mastery]}</span><span class="pwhen">${when}</span></div>
      ${m.text ? `<blockquote>${esc(m.text.length > 300 ? m.text.slice(0, 300) + "…" : m.text)}</blockquote>` : ""}
      ${inside ? `<div class="pin2"><small>${inside.tag}</small><p>${esc(inside.text.length > 230 ? inside.text.slice(0, 230) + "…" : inside.text)}</p></div>` : `<div class="pin2 empty"><p>Nothing saved in here yet. Open it and think out loud.</p></div>`}
      <div class="pfoot"><span>${[kept.length ? `${kept.length} saved` : "", asked ? `${asked} asked` : "", links ? `${links} link${links > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ") || esc(n?.title || "")}</span><b>Open marker<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></b></div>`;
    document.body.appendChild(p);
    // above the card when there's room, otherwise below; never off the sides
    const r = card.getBoundingClientRect(), w = Math.min(Math.max(r.width, 340), innerWidth - 24), h = p.offsetHeight;
    const floor = ($(".top")?.getBoundingClientRect().bottom ?? 0) + 8, above = r.top - h - 12 >= floor;
    p.style.width = w + "px";
    p.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
    p.style.top = (above ? r.top - h - 12 : Math.min(innerHeight - h - 12, r.bottom + 12)) + "px";
    p.classList.add(above ? "above" : "below");
    p.style.setProperty("--ax", Math.round(r.left + r.width / 2 - parseFloat(p.style.left)) + "px");
    p.addEventListener("pointerenter", () => clearTimeout(peekTimer));
    p.addEventListener("pointerleave", () => hidePeek());
    p.addEventListener("click", () => open(id));
  }, delay);
}
function hidePeek(now = false) {
  clearTimeout(peekTimer);
  const gone = () => { $("#fpeek")?.remove(); peekFor = null; };
  if (now) return gone();
  peekTimer = window.setTimeout(gone, 160);
}
/** Everything in one folder, for when it holds more than the dial can show. */
function showShelf(k: number) {
  const f = items[k];
  if (!f || f.loose) return;
  const fc = fcOf(f);
  openShelf({ title: f.custom ? titleCase(f.label) : f.more ? "More recent" : f.label, color: fc[0], ink: fc[1], notes: f.ns, from: G.els[k] ?? null, openNote: id => handlers?.openNote(id) });
}

function bindDial() {
  const d = $("#dial")!;
  let last = 0, v = 0, moved = 0, downEl: HTMLElement | null = null, pid: number | null = null;
  const ang = (e: PointerEvent) => { const r = d.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI; };
  d.addEventListener("pointerdown", e => {
    if (diving || e.button > 0 || (e.target as Element).closest(".hub")) return;
    dragging = true; moved = 0; v = 0; last = ang(e);
    downEl = (e.target as Element).closest<HTMLElement>(".seeall,.file,.folder");
    pid = e.pointerId; d.setPointerCapture(pid); d.classList.add("dragging");
  });
  d.addEventListener("pointermove", e => {
    if (!dragging || e.pointerId !== pid) return;
    const a = ang(e), dd = wrapDeg(a - last);
    rot += dd; target = rot; moved += Math.abs(dd); v = dd * 0.6 + v * 0.4; last = a;
    if (moved > 3 && hoverF >= 0) { hoverF = -1; hoverNote = null; paint(); updateInfo(); }
  });
  const up = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; d.classList.remove("dragging");
    if (moved < 3 && downEl) {
      const fi = Number(downEl.closest<HTMLElement>(".folder")!.dataset.f);
      if (!R && items[fi]?.add) editFolder(null); // one tap on the empty folder makes a new one
      else if (!R && downEl.classList.contains("seeall")) showShelf(fi);
      else if (!R && downEl.classList.contains("file") && (fi === sel || fi === hoverF)) handlers?.openNote(downEl.dataset.n!);
      else goTo(fi);
    } else target = snapFrom(rot + (reducedMotion() ? 0 : v * 9));
  };
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
  const folders = $("#folders")!;
  folders.addEventListener("pointerover", e => {
    if (dragging || diving || e.pointerType === "touch" || R) return;
    const fo = (e.target as Element).closest<HTMLElement>(".folder"), fl = (e.target as Element).closest<HTMLElement>(".file");
    const fi = fo ? Number(fo.dataset.f) : -1, nn = fl ? fl.dataset.n! : null;
    if (fi !== hoverF || nn !== hoverNote) { hoverF = fi; hoverNote = nn; paint(); updateInfo(); }
  });
  // the hub is a dome of glass: it leans a few degrees toward the pointer and the light on it moves the other way
  const hubEl = $("#hub")!;
  const level = () => { ["--hx", "--hy", "--lx", "--ly"].forEach(k => hubEl.style.removeProperty(k)); };
  d.addEventListener("pointermove", e => {
    if (e.pointerType === "touch" || diving || three || reducedMotion()) return;
    const r = d.getBoundingClientRect(), px = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2))), py = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2)));
    const k = R ? 2 : 6; // steadier while you're reading a recall card
    hubEl.style.setProperty("--hx", (-py * k).toFixed(2) + "deg");
    hubEl.style.setProperty("--hy", (px * k).toFixed(2) + "deg");
    hubEl.style.setProperty("--lx", (50 - px * 26).toFixed(1) + "%");
    hubEl.style.setProperty("--ly", (24 - py * 16).toFixed(1) + "%");
  });
  d.addEventListener("pointerleave", level);
  // a loose card leans toward the pointer, like a card held by its far edge
  let tilted: HTMLElement | null = null;
  const untilt = () => { tilted?.style.removeProperty("--tx"); tilted?.style.removeProperty("--ty"); tilted = null; };
  folders.addEventListener("pointermove", e => {
    if (e.pointerType === "touch" || dragging || diving || reducedMotion()) return untilt();
    const c = (e.target as Element).closest<HTMLElement>(".file.solo");
    if (c !== tilted) untilt();
    if (!c) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    c.style.setProperty("--tx", (-py * 9).toFixed(2) + "deg");
    c.style.setProperty("--ty", (px * 11).toFixed(2) + "deg");
    tilted = c;
  });
  folders.addEventListener("pointerleave", untilt);
  folders.addEventListener("pointerleave", () => { if (hoverF !== -1) { hoverF = -1; hoverNote = null; paint(); updateInfo(); } });
  let acc = 0;
  d.addEventListener("wheel", e => { e.preventDefault(); acc += e.deltaY + e.deltaX; if (Math.abs(acc) > 50) { goTo(sel + Math.sign(acc)); acc = 0; } }, { passive: false });
  d.addEventListener("keydown", e => {
    if (e.target !== d) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goTo(sel + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goTo(sel - 1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(items.length - 1); }
    else if (e.key === "Enter" && !R && items[sel]) { e.preventDefault(); if (items[sel].add) editFolder(null); else handlers?.openNote(items[sel].ns[0].id); }
  });
}

/* ---------- recall in the hub ---------- */
/** Start a recall session: what's due in the chosen scope, or a given set of markers (cramming for one course). */
/** Quiz these markers on the dial, now if it's showing or as soon as it next is. `label` names the run ("Exit ticket"). */
export function queueRecall(ids: string[], label: string) {
  pendingRecall = { ids, label };
  if (alive && $("#dial") && !R) runPendingRecall();
}
function runPendingRecall() {
  const p = pendingRecall;
  pendingRecall = null;
  if (!p || R) return;
  const ms = p.ids.map(id => state.markers.get(id)).filter((m): m is Marker => !!m && !m.deleted && recallable(m));
  if (ms.length) startRecall(ms, p.label);
}
function startRecall(custom?: Marker[], cram: string | null = null) {
  const q = custom || queue();
  if (!q.length) return;
  closePop();
  R = { queue: q.map(m => m.id), i: 0, revealed: false, got: 0, done: false, k: -1, typed: "", missed: [], cram, ai: null, checking: false, results: [] };
  hidePeek(true);
  openSheet();
  showRecall();
}
/** The run of questions along the side of the sheet: done ones show how they went, the current one is lit. */
function setProg() {
  const side = $("#rsSide"), bar = $("#rsBar");
  if (!R) return;
  if (bar) bar.style.setProperty("--p", String(R.done ? 1 : R.i / R.queue.length));
  if (!side) return;
  side.innerHTML = `<h3>${R.done ? "All done" : `${R.queue.length - R.i} to go`}</h3><ol>${R.queue.map((id, i) => {
    if (R!.quiz) { const st = i < R!.i ? (R!.results[i] ? "got" : "again") : i === R!.i && !R!.done ? "now" : "later"; return `<li data-st="${st}" style="--c:var(--g2)"><i></i><span>Question ${i + 1}</span></li>`; }
    const m = state.markers.get(id), n = m ? note(m.noteId) : undefined;
    const st = i < R!.i ? (R!.results[i] ? "got" : "again") : i === R!.i && !R!.done ? "now" : "later";
    return `<li data-st="${st}" style="--c:${n ? courseColor(n.courseId) : "var(--muted)"}"><i></i><span>${esc(n?.title || "A note")}</span></li>`;
  }).join("")}</ol>`;
  side.querySelector('[data-st="now"]')?.scrollIntoView({ block: "nearest" });
}
function reveal() {
  if (!R || R.revealed || R.done) return;
  R.typed = (($("#rAns") as HTMLInputElement | null)?.value || "").trim();
  R.revealed = true;
  showRecall();
}
function showRecall() {
  const el = $("#rsStage");
  if (!el || !R) return;
  el.dataset.key = "";
  if (R.quiz) return R.done ? showQuizDone() : showQuizCard();
  if (R.done) return showDone();
  const m = state.markers.get(R.queue[R.i]);
  const n = m ? note(m.noteId) : undefined;
  if (!m || !n) { R.i++; if (R.i >= R.queue.length) R.done = true; return showRecall(); }
  setHc(courseColor(n.courseId), el);
  $("#recallSheet")?.style.setProperty("--hc", courseColor(n.courseId));
  const { q, a } = recallText(m);
  // If the student typed an answer first, show which of the stored answer's key ideas they included.
  const cmp = R.revealed && R.typed ? compareAnswer(R.typed, a) : null;
  const strong = cmp ? cmp.total > 0 && cmp.hit / cmp.total >= 0.6 : true;
  const flip = R.revealed && !R.flipped; // the card turns over once, when the answer is first shown
  if (R.revealed) R.flipped = true;
  el.innerHTML = `<div class="rscard${flip ? " flip" : ""}${R.revealed ? " back" : ""}" style="--c:${courseColor(n.courseId)}"><div class="rtop"><span class="pill" style="background:${courseColor(n.courseId)}">${esc(courseName(n.courseId))}</span><span class="rcount">${R.i + 1} / ${R.queue.length}</span></div>
    <div class="rq">${esc(q)}</div><div class="rsrc">from <b>${esc(n.title)}</b></div>
    ${R.revealed
      ? `${R.typed ? `<div class="ryou"><small>${R.spoke ? "You said" : "You wrote"}</small>${esc(R.typed)}</div>` : ""}
         <div class="ra">${cmp ? cmp.html : esc(a)}</div>
         ${cmp && cmp.total ? `<div class="rscore ${strong ? "ok" : "low"}"><b>${cmp.hit} of ${cmp.total}</b> key ideas${aiOn && !R.ai ? ` · <button class="rcheck" id="rCheck" ${R.checking ? "disabled" : ""}>${R.checking ? "Checking…" : "Check with AI"}</button>` : ""}</div>` : ""}
         ${R.ai ? `<div class="rai">${esc(R.ai)}</div>` : ""}
         <div class="racts"><button class="again">Again<kbd>1</kbd></button><button class="got">Got it<kbd>2</kbd></button></div>`
      : `<div class="ransrow"><input id="rAns" class="rans" autocomplete="off" autocapitalize="sentences" maxlength="400" placeholder="${canListen() ? "Type it, or say it out loud" : "Type what you remember (optional)"}" aria-label="Your answer from memory">${canListen() ? `<button class="rmic" id="rMic" aria-pressed="false" aria-label="Say your answer out loud" title="Say it out loud">${MIC}</button>` : ""}</div>
         ${beadsHTML(a)}
         <button class="openlink" id="reveal">Show answer</button>`}</div>`;
  if (R.revealed) {
    const again = el.querySelector<HTMLButtonElement>(".again")!, got = el.querySelector<HTMLButtonElement>(".got")!;
    again.onclick = () => grade(m, false);
    got.onclick = () => grade(m, true);
    (strong ? got : again).focus({ preventScroll: true });
    const chk = $("#rCheck");
    if (chk) chk.onclick = () => aiCheck(m.id, q, a);
  } else {
    const b = $("#reveal")!, inp = $("#rAns") as HTMLInputElement;
    b.onclick = reveal;
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); reveal(); } };
    inp.oninput = () => fillBeads(inp.value, a);
    const mic = $("#rMic");
    if (mic) mic.onclick = () => (mic.getAttribute("aria-pressed") === "true" ? heard?.stop() : sayAnswer(a));
    // a mouse or keyboard goes straight to typing; on touch, focusing would cover the dial with the on-screen keyboard
    if (!loud()) (matchMedia("(pointer: fine)").matches ? inp : b).focus({ preventScroll: true });
  }
  setProg();
  if (loud()) void loudTurn(m, q, a, cmp);
}

/* ---------- recall out loud ----------
   Say it back: the mic beside the answer box listens while you explain the answer in your own words. A row of beads,
   one per key idea in the hidden answer, fills as you say them, so you can tell you've only got two of five without
   seeing the answer. A pause turns the card over with what you said marked against it.
   Out loud (the headphones in the sheet's corner) does it hands-free, for a walk to class: each question is read to
   you, you answer aloud, the answer is read back, and "got it" or "again" grades it. */
let heard: Listening | null = null, turn = "";
const LOUD = "lb-recall-loud";
const loud = () => { try { return canListen() && localStorage.getItem(LOUD) === "1"; } catch { return false; } };
function beadsHTML(a: string) {
  const total = compareAnswer("", a).total;
  return total > 1 ? `<div class="rbeads" id="rBeads" aria-live="polite" aria-label="Key ideas you've said: 0 of ${total}" data-total="${total}">${"<i></i>".repeat(Math.min(total, 12))}<small>0 of ${total} key ideas</small></div>` : "";
}
function fillBeads(text: string, a: string) {
  const row = $("#rBeads");
  if (!row) return;
  const { hit, total } = compareAnswer(text, a);
  row.classList.toggle("on", !!text.trim());
  row.querySelectorAll("i").forEach((b, i) => { const was = b.classList.contains("hit"); b.classList.toggle("hit", i < hit); if (!was && i < hit && !reducedMotion()) b.animate([{ transform: "scale(1.9)" }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(.2,.9,.3,1.4)" }); });
  row.querySelector("small")!.textContent = `${hit} of ${total} key ideas`;
  row.setAttribute("aria-label", `Key ideas you've said: ${hit} of ${total}`);
}
/** Listens for the answer to the card on screen; a pause, or the mic again, turns it over. */
function sayAnswer(a: string, then?: () => void) {
  if (!R || R.revealed) return;
  const card = $(".rscard"), mic = $("#rMic"), inp = $("#rAns") as HTMLInputElement | null, at = R.i;
  const off = () => { card?.classList.remove("listening"); mic?.setAttribute("aria-pressed", "false"); heard = null; };
  heard = listen({
    pauseMs: 2200,
    onWords: t => { if (!R || R.i !== at || R.revealed) return; if (inp) inp.value = t; fillBeads(t, a); },
    onDone: t => { off(); if (!R || R.i !== at || R.revealed) return; if (inp && t) inp.value = t; R.spoke = !!t; if (t || !loud()) reveal(); then?.(); },
    onError: msg => { off(); toast(msg, 4200); }
  });
  if (heard) { card?.classList.add("listening"); mic?.setAttribute("aria-pressed", "true"); }
}
/** One step of hands-free recall, run once per card side. */
async function loudTurn(m: Marker | ((good: boolean) => void), q: string, a: string, cmp: { hit: number; total: number } | null) {
  const mark = (good: boolean) => typeof m === "function" ? m(good) : void grade(m, good);
  if (!R) return;
  const key = `${R.i}:${R.revealed}`;
  if (turn === key) return;
  turn = key;
  const still = () => R && turn === key && $("#recallSheet");
  if (!R.revealed) {
    await say(q);
    if (still()) sayAnswer(a);
    return;
  }
  await say(`${cmp && cmp.total ? `You said ${cmp.hit} of ${cmp.total} key ideas. ` : ""}${a.slice(0, 400)}. Got it, or again?`);
  if (!still()) return;
  heard = listen({
    pauseMs: 1300,
    onDone: t => {
      heard = null;
      if (!still()) return;
      const w = t.toLowerCase();
      if (/\b(stop|done|finish|enough|quit)\b/.test(w)) endRecall();
      else if (/\b(again|no|nope|missed|didn'?t|not|wrong)\b/.test(w)) mark(false);
      else if (/\b(got|yes|yeah|yep|knew|right|correct|easy|next)\b/.test(w)) mark(true);
      else if (/\b(repeat|again please|what)\b/.test(w)) { turn = ""; void loudTurn(m, q, a, cmp); }
      else { turn = ""; void loudTurn(m, q, a, cmp); }
    },
    onError: msg => { heard = null; toast(msg, 4200); }
  });
}
function setLoud(on: boolean) {
  try { localStorage.setItem(LOUD, on ? "1" : "0"); } catch { /* storage blocked */ }
  $("#rsLoud")?.setAttribute("aria-pressed", String(on));
  heard?.cancel(); heard = null; hush(); turn = "";
  if (on) toast("Out loud: questions are read to you. Answer aloud, then say “got it” or “again”.", 4200);
  showRecall();
}
/** Ask the AI whether a typed answer captures the stored one. Optional, one tap, and never changes the grade by itself. */
async function aiCheck(id: string, q: string, a: string) {
  if (!R || R.checking) return;
  const typed = R.typed;
  R.checking = true;
  showRecall();
  let verdict: string;
  try {
    const r = await askMarker({ intent: `I answered a recall question from memory. In at most two short sentences, tell me what I got right and what I missed or got wrong. Be direct and kind. Don't restate the full answer.\nQuestion: ${q.slice(0, 160)}\nMy answer: ${typed.slice(0, 260)}`, passage: a.slice(0, 1500), before: "", after: "", note: "", title: note(state.markers.get(id)?.noteId)?.title || "", course: "", thread: [] });
    verdict = r.markdown.replace(/[#*_`>]/g, "").trim().slice(0, 320);
  } catch (e) { verdict = (e as Error).message; }
  if (!R || R.queue[R.i] !== id || !R.revealed) return;
  R.checking = false;
  R.ai = verdict;
  showRecall();
}
async function grade(m: Marker, good: boolean) {
  if (!R) return;
  await gradeMarker(m, good);
  if (good) R.got++; else R.missed.push(m.id);
  R.results.push(good);
  R.i++;
  R.revealed = false; R.flipped = false; R.spoke = false;
  R.typed = "";
  R.ai = null;
  R.checking = false;
  if (R.i >= R.queue.length) {
    R.done = true;
    if (!doneToday()) await putMeta({ studyDays: [...state.meta.studyDays, dayKey(Date.now())] });
  }
  showRecall();
}
/* ---------- pop quizzes ----------
   A teacher's pop quiz runs in the same sheet as recall, one question at a time: answer from memory (typed or out
   loud, with the key-idea beads), show the teacher's answer, mark it Got it or Again. At the end the marks and words
   go to the teacher once, and the student carries on to their own recall if any is waiting. */
function startQuiz(id?: string): boolean {
  const all = pendingQuizzes(), q = id ? all.find(x => x.id === id) : all[0];
  if (!q || R) return false;
  closePop();
  R = { queue: q.questions.map((_, i) => String(i)), i: 0, revealed: false, got: 0, done: false, k: -1, typed: "", missed: [], cram: null, ai: null, checking: false, results: [],
    quiz: { id: q.id, title: q.title, className: q.className, teacher: q.teacher, required: q.required, items: q.questions, answers: [], sent: null, error: "" } };
  hidePeek(true);
  openSheet();
  showRecall();
  return true;
}
function showQuizCard() {
  const el = $("#rsStage"), z = R?.quiz;
  if (!el || !R || !z) return;
  const { q, a } = z.items[R.i], color = "var(--g2)";
  setHc(color, el);
  $("#recallSheet")?.style.setProperty("--hc", color);
  const cmp = R.revealed && R.typed ? compareAnswer(R.typed, a) : null;
  const strong = cmp ? cmp.total > 0 && cmp.hit / cmp.total >= 0.6 : true;
  const flip = R.revealed && !R.flipped;
  if (R.revealed) R.flipped = true;
  el.innerHTML = `<div class="rscard quizcard${flip ? " flip" : ""}${R.revealed ? " back" : ""}" style="--c:${color}"><div class="rtop"><span class="pill" style="background:${color}">Pop quiz</span><span class="rcount">${R.i + 1} / ${R.queue.length}</span></div>
    <div class="rq">${esc(q)}</div><div class="rsrc">${z.teacher ? `from <b>${esc(z.teacher)}</b> · ` : ""}${esc(z.className)}</div>
    ${R.revealed
      ? `${R.typed ? `<div class="ryou"><small>${R.spoke ? "You said" : "You wrote"}</small>${esc(R.typed)}</div>` : ""}
         <div class="ra">${a ? (cmp ? cmp.html : esc(a)) : "<em>No answer given. Mark it the way you think it went.</em>"}</div>
         ${cmp && cmp.total ? `<div class="rscore ${strong ? "ok" : "low"}"><b>${cmp.hit} of ${cmp.total}</b> key ideas</div>` : ""}
         <div class="racts"><button class="again">Again<kbd>1</kbd></button><button class="got">Got it<kbd>2</kbd></button></div>`
      : `<div class="ransrow"><input id="rAns" class="rans" autocomplete="off" autocapitalize="sentences" maxlength="400" placeholder="${canListen() ? "Type it, or say it out loud" : "Type your answer"}" aria-label="Your answer from memory">${canListen() ? `<button class="rmic" id="rMic" aria-pressed="false" aria-label="Say your answer out loud" title="Say it out loud">${MIC}</button>` : ""}</div>
         ${a ? beadsHTML(a) : ""}
         <button class="openlink" id="reveal">Show answer</button>`}</div>`;
  if (R.revealed) {
    const again = el.querySelector<HTMLButtonElement>(".again")!, got = el.querySelector<HTMLButtonElement>(".got")!;
    again.onclick = () => void gradeQuiz(false);
    got.onclick = () => void gradeQuiz(true);
    (strong ? got : again).focus({ preventScroll: true });
  } else {
    const b = $("#reveal")!, inp = $("#rAns") as HTMLInputElement;
    b.onclick = reveal;
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); reveal(); } };
    inp.oninput = () => { if (a) fillBeads(inp.value, a); };
    const mic = $("#rMic");
    if (mic) mic.onclick = () => (mic.getAttribute("aria-pressed") === "true" ? heard?.stop() : sayAnswer(a));
    if (!loud()) (matchMedia("(pointer: fine)").matches ? inp : b).focus({ preventScroll: true });
  }
  setProg();
  if (loud()) void loudTurn(good => void gradeQuiz(good), q, a, cmp);
}
async function gradeQuiz(good: boolean) {
  const z = R?.quiz;
  if (!R || !z || R.done) return;
  z.answers.push({ got: good, said: R.typed.slice(0, 400) });
  R.results.push(good);
  if (good) R.got++;
  R.i++;
  R.revealed = false; R.flipped = false; R.spoke = false; R.typed = "";
  if (R.i >= R.queue.length) {
    R.done = true;
    await sendQuizNow();
    if (!doneToday()) await putMeta({ studyDays: [...state.meta.studyDays, dayKey(Date.now())] }); // a quiz is recall too
  }
  showRecall();
}
async function sendQuizNow() {
  const z = R?.quiz;
  if (!z) return;
  z.error = "";
  try { z.sent = await sendQuiz(z.id, z.answers); }
  catch (e) { z.error = (e as Error).message || "Couldn't send it."; }
}
function showQuizDone() {
  const el = $("#rsStage"), z = R?.quiz;
  if (!el || !R || !z) return;
  setHc("var(--g1)", el);
  const next = pendingQuizzes().find(x => x.id !== z.id), due = queue().length;
  const score = z.sent ? `${z.sent.score} / ${z.sent.total}` : `${R.got} / ${R.queue.length}`;
  el.innerHTML = `<div class="rscard done quizdone"><span class="pill" style="background:var(--g2)">Pop quiz done</span><div class="donebig">${score}</div>
    <div class="rsrc">${z.sent ? `Sent to ${z.teacher ? esc(z.teacher) : "your teacher"}` : `<span class="qerr">Not sent yet: ${esc(z.error)}</span>`}</div>
    ${z.sent ? "" : `<button class="openlink" id="qRetry">Try sending again</button>`}
    ${next ? `<button class="openlink" id="qNext">Next quiz: ${esc(next.title)}</button>` : due ? `<button class="openlink" id="qGo">Now your recall · ${due}</button>` : ""}
    <button class="${next || due ? "linkbtn" : "openlink"}" id="doneBtn">Back to notes</button></div>`;
  $("#recallSheet")?.style.setProperty("--hc", "var(--g1)");
  $("#doneBtn")!.onclick = endRecall;
  const retry = $("#qRetry"); if (retry) retry.onclick = async () => { retry.setAttribute("disabled", ""); await sendQuizNow(); showRecall(); };
  const nx = $("#qNext"); if (nx && next) nx.onclick = () => { R = null; closeSheet(true); startQuiz(next.id); };
  const go = $("#qGo"); if (go) go.onclick = () => { R = null; closeSheet(true); startRecall(); };
  (nx || go || $("#doneBtn"))!.focus({ preventScroll: true });
  if (loud()) void say(`Quiz done. ${score.replace(" / ", " out of ")}.${z.sent ? " Sent." : ""}`);
  setProg();
  renderMorning();
}
// a quiz arriving or being sent changes the slip; "Take it" on a quiz card starts that quiz (going home first if needed)
onQuizChange(() => { if (alive && !R) void renderMorning(); });
addEventListener("lb-take-quiz", e => {
  const id = (e as CustomEvent<string>).detail;
  if (alive && $("#dial")) { if (!startQuiz(id)) toast("That quiz is already done."); }
  else { quizWanted = id; location.hash = ""; }
});

function showDone() {
  const el = $("#rsStage");
  if (!el) return;
  setHc("var(--g1)", el);
  const cols = ["--g1", "--g2", "--g3", "--g4", "--g5", "--g6", "--g7"], s = streak();
  const shaky = [...new Set(R!.missed)].map(id => state.markers.get(id)).filter((m): m is Marker => !!m).slice(0, 2);
  el.innerHTML = `<div class="rscard done"><div class="burst" aria-hidden="true">${[...Array(22)].map((_, i) => { const a = (i / 22) * Math.PI * 2, r = 70 + (i % 4) * 22; return `<i style="background:var(${cols[i % 7]});--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px;--d:${(i % 5) * 40}ms"></i>`; }).join("")}</div>
    <span class="pill" style="background:var(--g1)">${R!.cram === "Exit ticket" ? "Exit ticket done" : R!.cram ? "Cram done" : "Recall done"}</span><div class="donebig">${s} day${s === 1 ? "" : "s"}</div>
    <div class="rsrc">${R!.got} of ${R!.queue.length} right · streak kept</div>
    ${shaky.length ? `<div class="shaky"><small>Still shaky · back in 10 minutes</small>${shaky.map(m => `<button data-shaky="${m.id}">${esc((m.recallQ || m.text || "A marker").slice(0, 46))}</button>`).join("")}</div>` : ""}
    <button class="openlink" id="doneBtn">Back to notes</button></div>`;
  $("#recallSheet")?.style.setProperty("--hc", "var(--g1)");
  $("#doneBtn")!.onclick = endRecall;
  $("#doneBtn")!.focus({ preventScroll: true });
  if (loud()) void say(`Recall done. ${R!.got} of ${R!.queue.length} right.`);
  el.querySelectorAll<HTMLButtonElement>("[data-shaky]").forEach(b => b.onclick = () => {
    const m = state.markers.get(b.dataset.shaky!);
    if (!m) return;
    setPendingOpen(m.id);
    handlers?.openNote(m.noteId);
  });
  setProg();
  renderMorning();
}
function endRecall() {
  if (!R) return;
  R = null;
  closeSheet();
  if ($("#dial") && handlers) renderHome($("#stage")!, handlers, true);
}

/* ---------- the recall slip and its sheet ----------
   Recall lives in a slip tucked into the left edge of the home screen. While something is due it bobs out every so
   often, and the first time LiveBoard is opened each day it slides out further and says how many are waiting.
   Tapping it pulls a sheet out from the edge over most of the screen (the slip grows into it), with the notes still
   faintly visible behind, and recall runs there, one question at a time, away from the dial. */
const SLIP_DAY = "lb-slip-hello";
function renderSlip(due: number, overdue: number) {
  let slip = document.querySelector<HTMLButtonElement>("#recallSlip");
  if (!slip) {
    slip = document.createElement("button");
    slip.id = "recallSlip"; slip.className = "rslip";
    slip.innerHTML = `<span class="rslip-wave" aria-hidden="true"></span><span class="rslip-n"></span><span class="rslip-l">Recall</span><span class="rslip-bubble" aria-hidden="true"></span>`;
    document.body.appendChild(slip);
    slip.onclick = () => { if (!R && !startQuiz()) startRecall(); };
  }
  // a teacher's pop quiz comes first: the slip says so, and required ones keep it lit until they're done
  const quiz = pendingQuizzes()[0], quizzes = pendingQuizzes().length;
  const state_ = quiz ? "quiz" : due ? "due" : doneToday() ? "done" : "none";
  slip.dataset.state = state_;
  slip.classList.toggle("required", !!quiz?.required);
  slip.disabled = !due && !quiz;
  slip.querySelector(".rslip-n")!.textContent = quiz ? String(quizzes) : due ? String(due) : "✓";
  slip.querySelector(".rslip-l")!.textContent = quiz ? "Quiz" : "Recall";
  slip.querySelector(".rslip-bubble")!.textContent = quiz ? `${quiz.required ? "Required" : "Pop"} quiz: ${quiz.title}${quiz.teacher ? ` · ${quiz.teacher}` : ""}${due ? ` · then ${due} to recall` : ""}` : overdue ? `${due} to recall · ${overdue} overdue` : `${due} to recall`;
  slip.setAttribute("aria-label", quiz ? `Take the pop quiz “${quiz.title}” from ${quiz.className}${quizzes > 1 ? `, and ${quizzes - 1} more` : ""}` : due ? `Start recall: ${due} marker${due === 1 ? "" : "s"} waiting` : doneToday() ? "Today's recall is done" : "Nothing to recall right now");
  slip.title = quiz ? "Take the pop quiz" : due ? "Start recall" : doneToday() ? "Today's recall is done" : "Nothing due";
  // the first time today: slide out and say so
  let today = "";
  try { today = localStorage.getItem(SLIP_DAY) || ""; } catch { /* storage blocked */ }
  if ((quiz || due && !doneToday()) && today !== dayKey(Date.now()) && !reducedMotion()) {
    try { localStorage.setItem(SLIP_DAY, dayKey(Date.now())); } catch { /* storage blocked */ }
    slip.classList.add("hello");
    setTimeout(() => slip?.classList.remove("hello"), 5200);
  }
}

/** The sheet's outline at the start of its slide: the slip's own rectangle, so the slip seems to grow into it. */
function slipClip(panel: HTMLElement) {
  const slip = document.querySelector<HTMLElement>("#recallSlip"), r = slip?.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  if (!r || !r.height) return `inset(40% calc(100% - 44px) 40% 0 round 0 16px 16px 0)`;
  return `inset(${Math.max(0, r.top - pr.top)}px ${Math.max(0, pr.width - r.right)}px ${Math.max(0, pr.bottom - r.bottom)}px 0 round 0 16px 16px 0)`;
}
function openSheet() {
  closeSheet(true);
  const wrap = document.createElement("div");
  wrap.id = "recallSheet"; wrap.className = "rsback";
  wrap.innerHTML = `<section class="rspanel" role="dialog" aria-modal="true" aria-labelledby="rsTitle">
      <div class="rsbar" id="rsBar" aria-hidden="true"><i></i></div>
      <header class="rshead"><div><span class="rskick">${R?.quiz ? `Pop quiz · ${esc(R.quiz.className)}${R.quiz.required ? " · required" : ""}` : R?.cram === "Exit ticket" ? "Exit ticket" : R?.cram ? "Cram" : "Recall"}</span><h2 id="rsTitle">${R?.quiz ? esc(R.quiz.title) : R?.cram === "Exit ticket" ? "What did today's lesson leave you with?" : "What do you remember?"}</h2></div>
        <span class="rsacts">${canListen() ? `<button class="rsloud" id="rsLoud" aria-pressed="${loud()}" title="Out loud: questions read to you, answered by voice, hands-free"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4.500" height="6.500" rx="2"/><rect x="16.500" y="14" width="4.500" height="6.500" rx="2"/></svg><span>Out loud</span></button>` : ""}
        <button class="rsclose" id="rsClose" aria-label="Close recall (Esc)" title="Close (Esc)">×</button></span></header>
      <div class="rsbody"><div class="rsstage" id="rsStage" aria-live="polite"></div><aside class="rsside" id="rsSide" aria-label="Questions"></aside></div>
    </section>`;
  document.body.appendChild(wrap);
  document.querySelector("#recallSlip")?.classList.add("out");
  wrap.querySelector<HTMLButtonElement>("#rsClose")!.onclick = endRecall;
  const lb = wrap.querySelector<HTMLButtonElement>("#rsLoud");
  if (lb) lb.onclick = () => setLoud(lb.getAttribute("aria-pressed") !== "true");
  wrap.addEventListener("pointerdown", e => { if (e.target === wrap) endRecall(); }); // the faint notes behind close it
  if (reducedMotion()) return;
  const panel = wrap.querySelector<HTMLElement>(".rspanel")!;
  wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
  panel.animate([
    { clipPath: slipClip(panel), transform: "translateX(-2%) scaleX(.98)", filter: "saturate(1.6)" },
    { clipPath: "inset(0 30% 0 0 round 0 40px 40px 0)", transform: "translateX(0) scaleX(1.01)", offset: .62 },
    { clipPath: "inset(0 0 0 0 round 0 28px 28px 0)", transform: "none", filter: "none" }
  ], { duration: 620, easing: "cubic-bezier(.7, 0, .2, 1)" });
  panel.querySelectorAll<HTMLElement>(".rshead, .rsstage, .rsside").forEach((x, i) => x.animate([{ opacity: 0, transform: "translateX(-40px)" }, { opacity: 1, transform: "none" }], { duration: 460, delay: 260 + i * 70, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "backwards" }));
}
function closeSheet(now = false) {
  heard?.cancel(); heard = null; hush(); turn = "";
  const wrap = document.querySelector<HTMLElement>("#recallSheet");
  document.querySelector("#recallSlip")?.classList.remove("out");
  if (!wrap) return;
  wrap.id = ""; // a new sheet can open while this one leaves
  if (now || reducedMotion()) { wrap.remove(); return; }
  const panel = wrap.querySelector<HTMLElement>(".rspanel")!;
  wrap.style.pointerEvents = "none";
  wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 120, easing: "ease-in", fill: "forwards" });
  panel.animate([{ clipPath: "inset(0 0 0 0 round 0 28px 28px 0)", transform: "none" }, { clipPath: slipClip(panel), transform: "translateX(-2%)" }], { duration: 480, easing: "cubic-bezier(.6, 0, .3, 1)", fill: "forwards" })
    .finished.then(() => wrap.remove(), () => wrap.remove());
}

/* ---------- global listeners (installed once) ---------- */
let installed = false;
export function installHomeListeners() {
  if (installed) return;
  installed = true;
  addEventListener("resize", () => { if (alive && $("#dial")) { sizeDial(); lastDrawn = null; } });
  // Dial-first home: the top line and what's under the dial stay tucked away, and come up to full size when you go to
  // them. Hover and keyboard focus are handled in CSS; this covers scrolling toward them and touch.
  const stage = $("#stage")!;
  let sleep = 0;
  const wake = (top: boolean) => { const w = $(".dialwrap"); if (!w) return; w.classList.toggle("wake-top", top); clearTimeout(sleep); if (top) sleep = window.setTimeout(() => $(".dialwrap")?.classList.remove("wake-top"), 6000); };
  stage.addEventListener("wheel", e => {
    if (!alive || (e.target as Element).closest("#dial, .lbpop")) return; // over the dial the wheel spins it
    if (e.deltaY < -4 && stage.scrollTop <= 0) wake(true); else if (e.deltaY > 4) wake(false);
  }, { passive: true });
  stage.addEventListener("scroll", () => { if (alive) $(".dialwrap")?.classList.toggle("wake-bottom", stage.scrollTop > 40); }, { passive: true });
  stage.addEventListener("pointerdown", e => {
    if (!alive || e.pointerType === "mouse") return;
    const t = e.target as Element;
    if (t.closest("#morning")) wake(true); else if (t.closest("#dial")) wake(false);
  });
  // pulling down at the top of the page on a touch screen is "scrolling up to it"
  let touchY: number | null = null;
  stage.addEventListener("touchstart", e => { touchY = stage.scrollTop <= 0 && !(e.target as Element).closest("#dial") ? e.touches[0].clientY : null; }, { passive: true });
  stage.addEventListener("touchmove", e => { if (touchY != null && e.touches[0].clientY - touchY > 36) { wake(true); touchY = null; } }, { passive: true });
  document.addEventListener("pointerdown", e => { if (pop && !(e.target as Element).closest(".lbwrap")) closePop(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !alive) return;
    if (pop) { closePop(); return; }
    if (R) endRecall();
  });
  // Recall by keyboard: Space or Enter shows the answer, then 1 = Again, 2 = Got it.
  document.addEventListener("keydown", e => {
    if (!alive || !R || R.done || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, [contenteditable='true'], .sheetwrap, .searchwrap")) return;
    if (!R.revealed) { if ((e.key === " " || e.key === "Enter") && t.tagName !== "BUTTON") { e.preventDefault(); reveal(); } return; }
    if (e.key === "1" || e.key === "2") { e.preventDefault(); document.querySelector<HTMLButtonElement>(e.key === "1" ? ".racts .again" : ".racts .got")?.click(); }
  });
}
export const homeAlive = () => alive;
export const inRecall = () => !!R;
