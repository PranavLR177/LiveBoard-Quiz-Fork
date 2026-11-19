import { liveMarkers, liveNotes, note, putLocalMeta, state } from "./store";
import { recallable } from "./study";
import { getRole } from "./role";
import { $, DAY, dayKey, esc, reducedMotion } from "./util";
import { chime, play, setVolume, SOUNDS, stop as stopSound, type Sound } from "./focusSound";
import type { FocusEntry } from "./types";

/* Focus: a study timer that lives in the header and follows you between notes.
   Set any length on the dial (or type it), run it as one block or in cycles with breaks, name what you're working on,
   and pick what the screen does while it runs: quiet (only your note and the timer), held notifications, a background
   sound made on the device, a chime between blocks. It survives a reload. When it ends you get a summary and, if you
   marked anything, an exit ticket: a quick recall of exactly those markers. Finished sessions are kept on this device
   for the numbers on the setup screen (today, this week, a run of days). */

type Mode = "block" | "cycles";
interface Plan { mode: Mode; focus: number; brk: number; rounds: number; quiet: boolean; hold: boolean; sound: Sound; vol: number; chime: boolean; ticket: boolean }
interface Run extends Plan { start: number; phase: "focus" | "break"; round: number; phaseStart: number; phaseEnd: number; paused: number | null; focusMs: number; goal: string }

const RUN = "lb-focus-run", PLAN = "lb-focus-plan";
const PRESETS = [15, 25, 45, 60, 90];
const LAP = 120; // minutes once round the dial
const DEF: Plan = { mode: "block", focus: 25, brk: 5, rounds: 4, quiet: true, hold: true, sound: "off", vol: 0.5, chime: true, ticket: true };

let r: Run | null = null;
let plan: Plan = { ...DEF };
let goal = "", openWith = "";
let tick = 0, raf = 0;
let exitTicket: (ids: string[]) => void = () => {};
let openNote: (id: string) => void = () => {};
let keyH: ((e: KeyboardEvent) => void) | null = null;

const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* kept in memory until reload */ } };
const saveRun = () => write(RUN, r);
const savePlan = () => write(PLAN, plan);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const placed = (since: number) => liveMarkers().filter(m => m.createdAt >= since && !m.detachedAt && recallable(m));
const clock = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; };
const at = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dur = (mins: number) => mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
const totalMins = (p: Plan) => p.mode === "cycles" ? p.focus * p.rounds + p.brk * (p.rounds - 1) : p.focus;
const now = () => Date.now();
const focusedSoFar = (x: Run) => x.focusMs + (x.phase === "focus" ? Math.max(0, Math.min(x.paused ?? now(), x.phaseEnd) - x.phaseStart) : 0);

export const sessionRunning = () => !!r;

export function initSession(opts: { exitTicket: (ids: string[]) => void; openNote?: (id: string) => void }) {
  exitTicket = opts.exitTicket;
  if (opts.openNote) openNote = opts.openNote;
  plan = { ...DEF, ...(read<Partial<Plan>>(PLAN) || {}) };
  if (!SOUNDS.some(([k]) => k === plan.sound)) plan.sound = "off";
  const btn = $("#focusBtn");
  if (!btn) return;
  btn.removeAttribute("aria-controls");
  btn.setAttribute("aria-haspopup", "dialog");
  btn.onclick = e => { e.stopPropagation(); if ($("#focusSheet")) closeSheet(); else openSheet(); };
  const saved = read<Run>(RUN);
  if (saved && saved.phaseEnd > saved.start) { r = saved; catchUp(); }
  if (r) { tick = window.setInterval(beat, 1000); if (r.sound !== "off" && r.phase === "focus" && !r.paused) armSound(); }
  chip(); body();
}

/* Sound can only start after a tap, so a session restored by a reload waits for the first one. */
function armSound() {
  const go = () => { removeEventListener("pointerdown", go, true); removeEventListener("keydown", go, true); if (r && r.phase === "focus" && !r.paused) play(r.sound, r.vol); };
  addEventListener("pointerdown", go, true); addEventListener("keydown", go, true);
}

/* ---------- the clock ---------- */
function start() {
  const t = now();
  r = { ...plan, start: t, phase: "focus", round: 1, phaseStart: t, phaseEnd: t + plan.focus * 60000, paused: null, focusMs: 0, goal: goal.trim().slice(0, 140) };
  saveRun(); savePlan();
  clearInterval(tick); tick = window.setInterval(beat, 1000);
  $(".sessiondone")?.remove(); $(".focuscue")?.remove();
  if (r.sound !== "off") play(r.sound, r.vol);
  const target = openWith; openWith = "";
  closeSheet();
  chip(); body();
  if (target && note(target)) openNote(target);
}

/** Moves through any phases that ended while the app was closed or asleep. */
function catchUp() {
  while (r && !r.paused && now() >= r.phaseEnd) if (!advance(true)) return;
}
/** One phase is over. Returns false if the session finished. */
function advance(quietly = false): boolean {
  if (!r) return false;
  if (r.phase === "focus") {
    r.focusMs += Math.max(0, r.phaseEnd - r.phaseStart);
    if (r.mode === "cycles" && r.round < r.rounds) {
      r.phase = "break"; r.phaseStart = r.phaseEnd; r.phaseEnd = r.phaseStart + r.brk * 60000;
      saveRun();
      if (!quietly) { stopSound(); if (r.chime) chime("break"); cue("break"); }
      return true;
    }
    finish(false, quietly);
    return false;
  }
  r.phase = "focus"; r.round++; r.phaseStart = r.phaseEnd; r.phaseEnd = r.phaseStart + r.focus * 60000;
  saveRun();
  if (!quietly) { if (r.sound !== "off") play(r.sound, r.vol); if (r.chime) chime("back"); cue("back"); }
  return true;
}
function beat() {
  if (!r) return;
  if (!r.paused && now() >= r.phaseEnd) advance();
  chip(); body();
  if ($("#focusSheet") && r) drawRunning(false);
}
function pause() {
  if (!r) return;
  if (r.paused) { const d = now() - r.paused; r.phaseStart += d; r.phaseEnd += d; r.paused = null; if (r.phase === "focus" && r.sound !== "off") play(r.sound, r.vol); }
  else { r.paused = now(); stopSound(); }
  saveRun(); chip(); body(); if ($("#focusSheet")) drawRunning(true);
}
function addFive() { if (!r) return; r.phaseEnd += 5 * 60000; saveRun(); chip(); if ($("#focusSheet")) drawRunning(true); }
function skip() { if (!r) return; if (r.paused) { r.phaseStart += now() - r.paused; r.paused = null; } r.phaseEnd = now(); advance(); chip(); body(); if ($("#focusSheet") && r) drawRunning(true); }

function finish(early: boolean, quietly = false) {
  if (!r) return;
  const done = r;
  if (early) done.focusMs = focusedSoFar(done);
  r = null; saveRun(); clearInterval(tick); stopSound(); body(); chip();
  $(".focuscue")?.remove();
  closeSheet(true);
  const ids = placed(done.start).map(m => m.id), mins = Math.round(done.focusMs / 60000);
  const rounds = done.mode === "cycles" ? done.round : 1;
  const entry: FocusEntry = { at: now(), mins, markers: ids.length, rounds, ...(done.goal ? { goal: done.goal, met: null } : {}) };
  if (mins >= 1) void putLocalMeta({ focusLog: [...(state.meta.focusLog || []), entry].slice(-400) });
  if (!quietly && done.chime && !early) chime("done");
  summary(done, entry, ids, early);
}

/* ---------- what shows outside the sheet ---------- */
function chip() {
  const btn = $("#focusBtn"); if (!btn) return;
  btn.setAttribute("aria-expanded", String(!!$("#focusSheet")));
  btn.classList.toggle("on", !!r);
  btn.classList.toggle("brk", r?.phase === "break");
  btn.classList.toggle("paused", !!r?.paused);
  if (r) {
    const left = r.phaseEnd - (r.paused ?? now()), len = r.phaseEnd - r.phaseStart, n = placed(r.start).length;
    btn.style.setProperty("--p", (100 * clamp(1 - left / Math.max(1, len), 0, 1)).toFixed(1));
    btn.setAttribute("aria-label", `Focus: ${r.paused ? "paused, " : ""}${r.phase === "break" ? "break, " : ""}${clock(left)} left`);
    $(".fbt", btn)!.textContent = r.paused ? `${clock(left)} · paused` : r.phase === "break" ? `Break ${clock(left)}` : clock(left);
    $(".fbn", btn)!.textContent = n ? String(n) : "";
    btn.title = r.goal ? `Focus: ${r.goal}` : "Focus";
  } else {
    btn.style.setProperty("--p", "0");
    btn.setAttribute("aria-label", "Focus timer");
    $(".fbt", btn)!.textContent = "Focus";
    $(".fbn", btn)!.textContent = "";
    btn.title = "Focus timer";
  }
}
/** Quiet screen and held notifications only apply while a focus block is actually running. */
function body() {
  const on = !!r && r.phase === "focus" && !r.paused;
  document.body.classList.toggle("focusquiet", on && r!.quiet);
  document.body.classList.toggle("focushold", !!r && r.hold);
  document.body.classList.toggle("focusing", !!r);
}

function cue(kind: "break" | "back") {
  if (!r) return;
  $(".focuscue")?.remove();
  const c = document.createElement("div");
  c.className = `focuscue ${kind}`; c.setAttribute("role", "status");
  c.innerHTML = kind === "break"
    ? `<b>Break · ${r.brk} min</b><span>Round ${r.round} of ${r.rounds} done</span><button id="cueSkip">Skip break</button><button id="cueX" aria-label="Dismiss">×</button>`
    : `<b>Back to it</b><span>Round ${r.round} of ${r.rounds}${r.goal ? ` · ${esc(r.goal)}` : ""}</span><button id="cueX" aria-label="Dismiss">×</button>`;
  document.body.appendChild(c);
  const bye = () => c.remove();
  ($("#cueX", c) as HTMLElement).onclick = bye;
  const sk = $("#cueSkip", c); if (sk) sk.onclick = () => { bye(); skip(); };
  setTimeout(bye, kind === "break" ? 30000 : 8000);
}

function summary(done: Run, entry: FocusEntry, ids: string[], early: boolean) {
  $(".sessiondone")?.remove();
  const card = document.createElement("div");
  card.className = "sessiondone"; card.setAttribute("role", "status");
  const bits = [`${dur(Math.max(entry.mins, 0)) === "0 min" ? "Under a minute" : dur(entry.mins)} focused`, ...(done.mode === "cycles" ? [`${entry.rounds} of ${done.rounds} round${done.rounds === 1 ? "" : "s"}`] : []), `${ids.length} marker${ids.length === 1 ? "" : "s"} placed`];
  const ticket = done.ticket && ids.length;
  card.innerHTML = `<b>${early ? "Session ended" : "Session done"}</b><span>${bits.join(" · ")}</span>
    ${done.goal ? `<div class="sdgoal"><p>Did you finish <q>${esc(done.goal)}</q>?</p><div class="sdrow"><button class="sdno" data-met="1">Yes</button><button class="sdno" data-met="0">Not yet</button></div></div>` : ""}
    ${ticket ? `<p>Quiz yourself on what you just marked?</p><div class="sdrow"><button class="sdgo" id="sdGo">Exit ticket · ${ids.length}</button><button class="sdno" id="sdNo">Not now</button></div>`
      : `<div class="sdrow"><button class="sdno" id="sdNo">Close</button></div>`}`;
  document.body.appendChild(card);
  const bye = () => card.remove();
  ($("#sdNo", card) as HTMLElement).onclick = bye;
  const go = $("#sdGo", card); if (go) go.onclick = () => { bye(); exitTicket(ids); };
  card.querySelectorAll<HTMLButtonElement>("[data-met]").forEach(b => b.onclick = () => {
    const met = b.dataset.met === "1", log = [...(state.meta.focusLog || [])], i = log.findIndex(x => x.at === entry.at);
    if (i >= 0) { log[i] = { ...log[i], met }; void putLocalMeta({ focusLog: log }); }
    const g = $(".sdgoal", card)!; g.innerHTML = `<p>${met ? "Done. ✓" : "Saved. Pick it up next time."}</p>`;
    if (!ticket) setTimeout(bye, 1400);
  });
}

/* ---------- the sheet ---------- */
function openSheet() {
  closeSheet(true);
  const back = document.createElement("div");
  back.id = "focusSheet"; back.className = "fcback";
  back.innerHTML = `<section class="fcsheet" role="dialog" aria-modal="true" aria-labelledby="fcH"></section>`;
  document.body.appendChild(back);
  const sheet = $(".fcsheet", back)!;
  if (r) drawRunning(true); else drawSetup();
  back.addEventListener("pointerdown", e => { if (e.target === back) closeSheet(); });
  keyH = e => {
    if (!$("#focusSheet")) return;
    const typing = (e.target as HTMLElement).closest("input, textarea, select");
    if (e.key === "Escape") { e.stopPropagation(); closeSheet(); $("#focusBtn")?.focus(); }
    else if (r && e.key === " " && !typing) { e.preventDefault(); pause(); }
  };
  addEventListener("keydown", keyH, true);
  chip();
  if (reducedMotion()) return;
  const b = $("#focusBtn")?.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
  const cx = b ? b.left + b.width / 2 - sr.left : sr.width / 2, cy = b ? b.top + b.height / 2 - sr.top : 0;
  back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
  sheet.animate([{ clipPath: `circle(24px at ${cx}px ${cy}px)` }, { clipPath: `circle(${Math.hypot(sr.width, sr.height) * 1.1}px at ${cx}px ${cy}px)` }], { duration: 620, easing: "cubic-bezier(.7, 0, .2, 1)" });
  sheet.querySelectorAll<HTMLElement>(".fcin").forEach((x, i) => x.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 160 + i * 50, easing: "cubic-bezier(.2,.9,.3,1.1)", fill: "backwards" }));
}
function closeSheet(now_ = false) {
  cancelAnimationFrame(raf);
  if (keyH) { removeEventListener("keydown", keyH, true); keyH = null; }
  const back = $("#focusSheet");
  if (back) {
    back.id = "";
    if (now_ || reducedMotion()) back.remove();
    else {
      const sheet = $(".fcsheet", back)!, b = $("#focusBtn")?.getBoundingClientRect(), sr = sheet.getBoundingClientRect();
      const cx = b ? b.left + b.width / 2 - sr.left : sr.width / 2, cy = b ? b.top + b.height / 2 - sr.top : 0;
      back.style.pointerEvents = "none";
      back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 120, fill: "forwards" });
      sheet.animate([{ clipPath: `circle(${Math.hypot(sr.width, sr.height) * 1.1}px at ${cx}px ${cy}px)` }, { clipPath: `circle(20px at ${cx}px ${cy}px)` }], { duration: 420, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" }).finished.then(() => back.remove(), () => back.remove());
    }
  }
  if (!r) stopSound(); // a preview stops with the sheet
  chip();
}

/* The dial: an arc from the top, one lap = two hours, with a knob to drag. */
const R0 = 120;
function arc(frac: number, rad = R0) {
  const f = clamp(frac, 0, 0.99999), a = f * Math.PI * 2, x = 150 + rad * Math.sin(a), y = 150 - rad * Math.cos(a);
  return `M150 ${150 - rad} A${rad} ${rad} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}
function dialSVG(frac: number, knob: boolean, ticks: boolean) {
  const a = clamp(frac, 0, 1) * Math.PI * 2, kx = 150 + R0 * Math.sin(a), ky = 150 - R0 * Math.cos(a);
  return `<svg class="fcdial" viewBox="0 0 300 300" aria-hidden="true">
    <defs><linearGradient id="fcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--g6)"/><stop offset=".55" stop-color="var(--g7)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient></defs>
    <circle cx="150" cy="150" r="${R0}" class="fctrack"/>
    ${ticks ? Array.from({ length: 24 }, (_, i) => { const t = i / 24 * Math.PI * 2, big = i % 6 === 0, r1 = R0 + 14, r2 = R0 + (big ? 22 : 18); return `<line x1="${(150 + r1 * Math.sin(t)).toFixed(1)}" y1="${(150 - r1 * Math.cos(t)).toFixed(1)}" x2="${(150 + r2 * Math.sin(t)).toFixed(1)}" y2="${(150 - r2 * Math.cos(t)).toFixed(1)}" class="fctick${big ? " big" : ""}"/>`; }).join("")
      + [0, 30, 60, 90].map((m, i) => { const t = i / 4 * Math.PI * 2, rr = R0 + 33; return `<text x="${(150 + rr * Math.sin(t)).toFixed(1)}" y="${(154 - rr * Math.cos(t)).toFixed(1)}" class="fclab">${m || "120"}</text>`; }).join("") : ""}
    <path d="${arc(frac)}" class="fcarc" id="fcArc"/>
    ${knob ? `<circle cx="${kx.toFixed(2)}" cy="${ky.toFixed(2)}" r="13" class="fcknob" id="fcKnob"/>` : `<circle cx="${kx.toFixed(2)}" cy="${ky.toFixed(2)}" r="7" class="fcdot" id="fcHead"/>`}
  </svg>`;
}

function weekStats() {
  const log = state.meta.focusLog || [], today = dayKey(now());
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now() - (6 - i) * DAY); return { key: dayKey(d.getTime()), label: d.toLocaleDateString(undefined, { weekday: "narrow" }), mins: 0 }; });
  for (const e of log) { const k = dayKey(e.at), d = days.find(x => x.key === k); if (d) d.mins += e.mins; }
  const set = new Set(log.filter(e => e.mins >= 1).map(e => dayKey(e.at)));
  let run = 0; for (let t = set.has(today) ? now() : now() - DAY; set.has(dayKey(t)); t -= DAY) run++;
  return { days, today: days[6].mins, week: days.reduce((t, d) => t + d.mins, 0), run, sessions: log.filter(e => dayKey(e.at) === today).length };
}

function drawSetup() {
  const sheet = $(".fcsheet"); if (!sheet) return;
  const st = weekStats(), max = Math.max(30, ...st.days.map(d => d.mins)), student = getRole() === "student";
  const notes = liveNotes().sort((a, b) => b.openedAt - a.openedAt).slice(0, 12);
  const here = location.hash.startsWith("#note-") ? location.hash.slice(6) : "";
  sheet.classList.remove("running");
  sheet.innerHTML = `<header class="fchead fcin"><div><h2 id="fcH">Focus</h2><small>${st.today ? `${dur(st.today)} today` : "Nothing yet today"}${st.run > 1 ? ` · ${st.run}-day streak` : ""}</small></div><button class="rsclose" id="fcClose" aria-label="Close (Esc)">×</button></header>
    <div class="fcbody">
      <div class="fcleft fcin">
        <div class="fcdialwrap" id="fcDialWrap" role="slider" tabindex="0" aria-label="Focus length in minutes" aria-valuemin="1" aria-valuemax="240" aria-valuenow="${plan.focus}">
          ${dialSVG(Math.min(plan.focus, LAP) / LAP, true, true)}
          <div class="fccenter"><label class="fcmin"><input id="fMinsIn" type="number" inputmode="numeric" min="1" max="240" value="${plan.focus}" aria-label="Minutes"><span>min</span></label><small id="fcEnds"></small></div>
        </div>
        <div class="fmins">${PRESETS.map(m => `<button data-min="${m}" class="${m === plan.focus ? "on" : ""}"><b>${m}</b>min</button>`).join("")}</div>
      </div>
      <div class="fcright">
        <section class="fcin"><h3>How</h3>
          <div class="fcseg" role="radiogroup" aria-label="Mode"><button role="radio" data-mode="block" aria-checked="${plan.mode === "block"}">One block</button><button role="radio" data-mode="cycles" aria-checked="${plan.mode === "cycles"}">Cycles with breaks</button></div>
          <div class="fccycles" ${plan.mode === "cycles" ? "" : "hidden"}>
            <div class="fcfield"><span>Break</span><div class="fcchips">${[5, 10, 15].map(b => `<button data-brk="${b}" aria-pressed="${plan.brk === b}">${b} min</button>`).join("")}</div></div>
            <div class="fcfield"><span>Rounds</span><div class="fcstep"><button id="fRoundsDown" aria-label="Fewer rounds">−</button><b id="fRounds">${plan.rounds}</b><button id="fRoundsUp" aria-label="More rounds">+</button></div></div>
          </div>
          <p class="fcsum" id="fcSum"></p>
        </section>
        <section class="fcin"><h3>Working on</h3>
          <input id="fGoal" class="fcinput" maxlength="140" placeholder="e.g. Chapter 4 problems" value="${esc(goal)}" autocomplete="off">
          <label class="fcfield"><span>Open</span><select id="fOpen" class="fcinput"><option value="">${here ? "This note" : "Nothing, stay here"}</option>${notes.filter(n => n.id !== here).map(n => `<option value="${esc(n.id)}" ${openWith === n.id ? "selected" : ""}>${esc(n.title || "Untitled")}</option>`).join("")}</select></label>
        </section>
        <section class="fcin"><h3>While it runs</h3>
          <label class="fcopt"><input type="checkbox" id="fQuiet" ${plan.quiet ? "checked" : ""}><span><b>Quiet screen</b><small>Hide everything but your note and the timer</small></span></label>
          ${student ? `<label class="fcopt"><input type="checkbox" id="fHold" ${plan.hold ? "checked" : ""}><span><b>Hold alerts</b><small>Lesson and quiz alerts wait until you're done</small></span></label>` : ""}
          <label class="fcopt"><input type="checkbox" id="fChime" ${plan.chime ? "checked" : ""}><span><b>Chime</b><small>When a block or break ends</small></span></label>
          <label class="fcopt"><input type="checkbox" id="fTicket" ${plan.ticket ? "checked" : ""}><span><b>Exit ticket</b><small>Quiz what you marked when you finish</small></span></label>
        </section>
        <section class="fcin"><h3>Sound</h3>${soundRow(plan.sound, plan.vol)}</section>
      </div>
    </div>
    <footer class="fcfoot fcin">
      <div class="fcweek" aria-label="Minutes focused, last 7 days">${st.days.map((d, i) => `<span title="${d.mins ? dur(d.mins) : "None"}"><i style="--h:${(d.mins / max * 100).toFixed(1)}%" class="${i === 6 ? "now" : ""}"></i><small>${d.label}</small></span>`).join("")}</div>
      <div class="fcweektxt"><b>${dur(st.week)}</b><small>this week</small></div>
      <button class="fcstart" id="fStart"></button>
    </footer>`;
  wireSetup(sheet);
}

function soundRow(cur: Sound, vol: number) {
  return `<div class="fcchips" id="fSound">${SOUNDS.map(([k, l]) => `<button data-sound="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>
    <label class="fcvol" ${cur === "off" ? "hidden" : ""}><span aria-hidden="true">🔈</span><input type="range" id="fVol" min="0" max="100" value="${Math.round(vol * 100)}" aria-label="Volume"><span aria-hidden="true">🔊</span></label>`;
}

function wireSetup(sheet: HTMLElement) {
  $("#fcClose", sheet)!.onclick = () => closeSheet();
  const wrap = $("#fcDialWrap", sheet)!, inp = $("#fMinsIn", sheet) as HTMLInputElement;
  const refresh = (fromInput = false) => {
    const frac = Math.min(plan.focus, LAP) / LAP, a = frac * Math.PI * 2;
    $("#fcArc", sheet)!.setAttribute("d", arc(frac));
    const k = $("#fcKnob", sheet)!; k.setAttribute("cx", (150 + R0 * Math.sin(a)).toFixed(2)); k.setAttribute("cy", (150 - R0 * Math.cos(a)).toFixed(2));
    if (!fromInput) inp.value = String(plan.focus);
    wrap.setAttribute("aria-valuenow", String(plan.focus)); wrap.setAttribute("aria-valuetext", dur(plan.focus));
    wrap.classList.toggle("over", plan.focus > LAP);
    sheet.querySelectorAll<HTMLButtonElement>("[data-min]").forEach(b => b.classList.toggle("on", Number(b.dataset.min) === plan.focus));
    const total = totalMins(plan);
    $("#fcEnds", sheet)!.textContent = `ends ${at(now() + total * 60000)}`;
    $("#fcSum", sheet)!.textContent = plan.mode === "cycles" ? `${plan.rounds} × ${plan.focus} min, ${plan.brk} min breaks · ${dur(total)} in all` : "";
    $("#fStart", sheet)!.innerHTML = `Start <b>${dur(total)}</b>`;
  };
  const setMins = (m: number, fromInput = false) => { plan.focus = clamp(Math.round(m), 1, 240); refresh(fromInput); };
  // drag round the dial; it snaps to 5 minutes
  const fromPoint = (e: PointerEvent) => {
    const b = wrap.querySelector("svg")!.getBoundingClientRect(), x = e.clientX - (b.left + b.width / 2), y = e.clientY - (b.top + b.height / 2);
    let ang = Math.atan2(x, -y); if (ang < 0) ang += Math.PI * 2;
    let m = Math.round(ang / (Math.PI * 2) * LAP / 5) * 5;
    if (m === 0) m = plan.focus > LAP / 2 ? LAP : 5; // across the top: stay at whichever end you came from
    setMins(Math.max(5, m));
  };
  let drag = false;
  wrap.addEventListener("pointerdown", e => { if ((e.target as Element).closest("input, label")) return; drag = true; wrap.setPointerCapture(e.pointerId); wrap.classList.add("dragging"); fromPoint(e); });
  wrap.addEventListener("pointermove", e => { if (drag) fromPoint(e); });
  const up = () => { drag = false; wrap.classList.remove("dragging"); };
  wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
  wrap.addEventListener("keydown", e => {
    if (e.target !== wrap) return;
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 5 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -5 : e.key === "PageUp" ? 15 : e.key === "PageDown" ? -15 : 0;
    if (d) { e.preventDefault(); setMins(Math.max(5, plan.focus + d)); }
    if (e.key === "Enter") { e.preventDefault(); start(); }
  });
  wrap.addEventListener("wheel", e => { e.preventDefault(); setMins(Math.max(5, plan.focus + (e.deltaY < 0 ? 5 : -5))); }, { passive: false });
  inp.oninput = () => { const v = Number(inp.value); if (v >= 1) setMins(v, true); };
  inp.onblur = () => { inp.value = String(plan.focus); };
  inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); start(); } };
  sheet.querySelectorAll<HTMLButtonElement>("[data-min]").forEach(b => b.onclick = () => setMins(Number(b.dataset.min)));
  sheet.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b => b.onclick = () => {
    plan.mode = b.dataset.mode as Mode;
    sheet.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(x => x.setAttribute("aria-checked", String(x === b)));
    const cy = $(".fccycles", sheet)!; cy.hidden = plan.mode !== "cycles";
    if (!cy.hidden && !reducedMotion()) cy.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
    if (plan.mode === "cycles" && plan.focus > 60) setMins(25); else refresh();
  });
  sheet.querySelectorAll<HTMLButtonElement>("[data-brk]").forEach(b => b.onclick = () => { plan.brk = Number(b.dataset.brk); sheet.querySelectorAll<HTMLButtonElement>("[data-brk]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); refresh(); });
  const rounds = (d: number) => { plan.rounds = clamp(plan.rounds + d, 2, 8); $("#fRounds", sheet)!.textContent = String(plan.rounds); refresh(); };
  $("#fRoundsDown", sheet)!.onclick = () => rounds(-1); $("#fRoundsUp", sheet)!.onclick = () => rounds(1);
  const g = $("#fGoal", sheet) as HTMLInputElement; g.oninput = () => { goal = g.value; };
  g.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); start(); } };
  const o = $("#fOpen", sheet) as HTMLSelectElement; o.onchange = () => { openWith = o.value; };
  const opt = (id: string, k: "quiet" | "hold" | "chime" | "ticket") => { const c = $(id, sheet) as HTMLInputElement | null; if (c) c.onchange = () => { plan[k] = c.checked; savePlan(); }; };
  opt("#fQuiet", "quiet"); opt("#fHold", "hold"); opt("#fChime", "chime"); opt("#fTicket", "ticket");
  wireSound(sheet, true);
  $("#fStart", sheet)!.onclick = start;
  refresh();
  setTimeout(() => wrap.focus({ preventScroll: true }), 50);
}

/** In setup a sound plays as a preview while the sheet is open; while running it changes the session's sound. */
function wireSound(sheet: HTMLElement, preview: boolean) {
  sheet.querySelectorAll<HTMLButtonElement>("[data-sound]").forEach(b => b.onclick = () => {
    const k = b.dataset.sound as Sound;
    sheet.querySelectorAll<HTMLButtonElement>("[data-sound]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    ($(".fcvol", sheet) as HTMLElement).hidden = k === "off";
    if (preview) { plan.sound = k; savePlan(); play(k, plan.vol); }
    else if (r) { r.sound = k; saveRun(); if (r.phase === "focus" && !r.paused) play(k, r.vol); else stopSound(); }
  });
  const v = $("#fVol", sheet) as HTMLInputElement | null;
  if (v) v.oninput = () => { const x = Number(v.value) / 100; if (preview) { plan.vol = x; savePlan(); } else if (r) { r.vol = x; saveRun(); } setVolume(x); };
}

function drawRunning(full: boolean) {
  const sheet = $(".fcsheet"); if (!sheet || !r) return;
  const x = r, left = x.phaseEnd - (x.paused ?? now()), len = x.phaseEnd - x.phaseStart, frac = clamp(left / Math.max(1, len), 0, 1);
  const marks = placed(x.start), student = getRole() === "student";
  if (full || !sheet.classList.contains("running") || sheet.dataset.phase !== x.phase + x.round + (x.paused ? "p" : "")) {
    sheet.classList.add("running"); sheet.dataset.phase = x.phase + x.round + (x.paused ? "p" : "");
    sheet.classList.toggle("onbreak", x.phase === "break");
    sheet.innerHTML = `<header class="fchead"><div><h2 id="fcH">${x.phase === "break" ? "Break" : "Focus"}</h2><small>${x.mode === "cycles" ? `Round ${x.round} of ${x.rounds}` : "One block"} · started ${at(x.start)}</small></div><button class="rsclose" id="fcClose" aria-label="Close (Esc)">×</button></header>
      <div class="fcbody">
        <div class="fcleft">
          <div class="fcdialwrap live ${x.paused ? "paused" : ""}">${dialSVG(frac, false, false)}
            <div class="fccenter"><b class="fcbig" id="fcBig">${clock(left)}</b><small id="fcEnds">${x.paused ? "paused" : `ends ${at(x.phaseEnd)}`}</small></div></div>
          <div class="frow fcctl"><button id="fPause" class="${x.paused ? "pri" : ""}">${x.paused ? "Resume" : "Pause"}</button><button data-add="5" id="fAdd">+5 min</button>${x.phase === "break" ? `<button id="fSkip">Skip break</button>` : ""}<button id="fEnd" class="end">End</button></div>
        </div>
        <div class="fcright">
          ${x.goal ? `<section><h3>Working on</h3><p class="fcgoal">${esc(x.goal)}</p></section>` : ""}
          <section><h3>Marked this session</h3>${marks.length ? `<ul class="fcmarks">${marks.slice(-5).reverse().map(m => `<li><i></i>${esc((m.text || m.draft || "A marker").slice(0, 110))}</li>`).join("")}</ul>${marks.length > 5 ? `<small class="fcmore">and ${marks.length - 5} more</small>` : ""}` : `<p class="fcnone">Nothing yet. Select text in a note to add a marker.</p>`}</section>
          <section><h3>Sound</h3>${soundRow(x.sound, x.vol)}</section>
          <section><h3>While it runs</h3>
            <label class="fcopt"><input type="checkbox" id="fQuiet" ${x.quiet ? "checked" : ""}><span><b>Quiet screen</b></span></label>
            ${student ? `<label class="fcopt"><input type="checkbox" id="fHold" ${x.hold ? "checked" : ""}><span><b>Hold alerts</b></span></label>` : ""}
            <label class="fcopt"><input type="checkbox" id="fChime" ${x.chime ? "checked" : ""}><span><b>Chime</b></span></label>
          </section>
        </div>
      </div>
      <footer class="fcfoot"><div class="fcrun"><b id="fcFocused">${dur(Math.floor(focusedSoFar(x) / 60000))}</b><small>focused so far</small></div><div class="fcrun"><b>${marks.length}</b><small>marker${marks.length === 1 ? "" : "s"}</small></div>${x.mode === "cycles" ? `<div class="fcpips" aria-label="Rounds">${Array.from({ length: x.rounds }, (_, i) => `<i class="${i + 1 < x.round || (i + 1 === x.round && x.phase === "break") ? "done" : i + 1 === x.round ? "now" : ""}"></i>`).join("")}</div>` : ""}</footer>`;
    $("#fcClose", sheet)!.onclick = () => closeSheet();
    $("#fPause", sheet)!.onclick = pause;
    $("#fAdd", sheet)!.onclick = addFive;
    const sk = $("#fSkip", sheet); if (sk) sk.onclick = skip;
    $("#fEnd", sheet)!.onclick = () => finish(true);
    const opt = (id: string, k: "quiet" | "hold" | "chime") => { const c = $(id, sheet) as HTMLInputElement | null; if (c) c.onchange = () => { if (r) { r[k] = c.checked; plan[k] = c.checked; saveRun(); savePlan(); body(); } }; };
    opt("#fQuiet", "quiet"); opt("#fHold", "hold"); opt("#fChime", "chime");
    wireSound(sheet, false);
  }
  // the ring runs down smoothly while the sheet is open
  cancelAnimationFrame(raf);
  const frame = () => {
    if (!r || !$("#focusSheet")) return;
    const l = r.phaseEnd - (r.paused ?? now()), f = clamp(l / Math.max(1, r.phaseEnd - r.phaseStart), 0, 1), a = f * Math.PI * 2;
    $("#fcArc", sheet)?.setAttribute("d", arc(f));
    const h = $("#fcHead", sheet); if (h) { h.setAttribute("cx", (150 + R0 * Math.sin(a)).toFixed(2)); h.setAttribute("cy", (150 - R0 * Math.cos(a)).toFixed(2)); }
    const big = $("#fcBig", sheet); if (big) big.textContent = clock(l);
    const fo = $("#fcFocused", sheet); if (fo) fo.textContent = dur(Math.floor(focusedSoFar(r) / 60000));
    if (!r.paused && !reducedMotion()) raf = requestAnimationFrame(frame);
  };
  frame();
}
