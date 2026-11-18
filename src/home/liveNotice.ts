import type { ClassPing, MyClass, Quiz } from "../sync";
import { classes as src } from "../classSource";
import { getRole } from "../role";
import { esc } from "../util";
import { goLive } from "./classes";

/* When a teacher starts a live lesson for one of your classes, a card slides in at the side of the screen with a
   button into it. The news is pushed (Supabase Realtime, see subscribeClassPings in src/sync.ts): LiveBoard asks for
   your classes once when you're signed in as a student, then just listens. It asks once more only when you come back
   to LiveBoard after a long while away, in case the connection slept through a ping. Dismissing a card hides that
   lesson for good on this device; the Classes screen still shows it as live. */

const SEEN = "lb-live-dismissed";
const AWAY = 5 * 60_000; // back after this long: ask once, in case a ping was missed while the connection slept
const seen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(SEEN) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; } };
const remember = (room: string) => { try { localStorage.setItem(SEEN, JSON.stringify([room, ...seen()].slice(0, 30))); } catch { /* storage blocked */ } };

/* Pop quizzes travel the same way: a teacher releasing one pings the class, the quiz list is fetched again, and a
   card says it has arrived. The recall slip then leads with it (src/home/home.ts), required ones until they're done. */
let quizzes: Quiz[] = [];
const quizListeners = new Set<() => void>();
/** Quizzes still to take: required first, then the soonest due, then the newest. */
export const pendingQuizzes = () => quizzes.filter(q => !q.done && q.questions.length).sort((a, b) => Number(b.required) - Number(a.required) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.createdAt - a.createdAt);
export const allQuizzes = () => quizzes;
export function onQuizChange(fn: () => void) { quizListeners.add(fn); return () => { quizListeners.delete(fn); }; }
/** Sends a quiz's result and marks it done here. */
export async function sendQuiz(id: string, answers: { got: boolean; said: string }[]) {
  const r = await src.submitQuiz(id, answers);
  const q = quizzes.find(x => x.id === id); if (q) Object.assign(q, { done: true, score: r.score, total: r.total });
  quizListeners.forEach(fn => fn());
  return r;
}
async function loadQuizzes(announce?: string) {
  const got = await src.myQuizzes();
  if (!got) return;
  quizzes = got;
  quizListeners.forEach(fn => fn());
  const q = announce ? quizzes.find(x => x.id === announce && !x.done) : null;
  if (q) quizCard(q);
}

let started = false, list: MyClass[] = [], unsubscribe: (() => void) | null = null, hiddenAt = 0, asking = false;
const listeners = new Set<(classes: MyClass[]) => void>();

/** Called with the classes (live lessons and all) whenever a ping changes them. Returns a function that stops it. */
export function onLiveChange(fn: (classes: MyClass[]) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** The classes as last heard. */
export const knownClasses = () => list;

export function startLiveNotices() {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > AWAY) void check(true);
    hiddenAt = 0;
  });
  addEventListener("lb-role-switched", () => void check());
  addEventListener("hashchange", () => { if (location.hash === "#classes") show(null); else paint(); });
  void check();
}

/** Starts listening if a student is signed in, and stops if not (called on start-up and after signing in or out).
 *  `again` asks for the classes even when already listening. */
export async function check(again = false) {
  await src.ready();
  if (getRole() !== "student" || !src.signedIn()) { unsubscribe?.(); unsubscribe = null; list = []; quizzes = []; quizListeners.forEach(fn => fn()); show(null); return; }
  if (unsubscribe && !again) return;
  if (!unsubscribe) unsubscribe = src.subscribe(ping);
  await refresh();
}

async function refresh() {
  if (asking) return;
  asking = true;
  try { const got = await src.myClasses(); if (got) { list = got; tell(); } await loadQuizzes(); } finally { asking = false; }
}

function ping(p: ClassPing) {
  if (p.type === "quiz") { void loadQuizzes(p.quizId); return; }
  const c = list.find(x => x.id === p.classId);
  if (!c) { if (p.type === "live") void refresh(); return; } // a class joined on another device: learn it
  if (p.type === "live") { c.liveRoom = p.room; c.liveTitle = p.title; } else { c.liveRoom = null; c.liveTitle = null; }
  tell();
}

function tell() { paint(); listeners.forEach(fn => fn(list)); }

function paint() {
  if (getRole() !== "student" || location.hash === "#classes") { show(null); return; } // the Classes screen shows the lesson itself
  const off = seen();
  show(list.find(c => c.liveRoom && !off.includes(c.liveRoom)) || null);
}

function show(c: MyClass | null) {
  let card = document.querySelector<HTMLElement>("#liveNotice");
  if (!c) { card?.remove(); return; }
  if (card?.dataset.room === c.liveRoom) return;
  card?.remove();
  card = document.createElement("aside");
  card.id = "liveNotice"; card.className = "livenotice"; card.dataset.room = c.liveRoom!;
  card.setAttribute("role", "status"); card.setAttribute("aria-label", `${c.name} is live`);
  card.innerHTML = `<span class="lnpulse" aria-hidden="true"></span><div class="lntext"><small>Live now · ${esc(c.name)}</small><b>${esc(c.liveTitle || "A lesson")}</b>${c.teacher ? `<span>${esc(c.teacher)} started it</span>` : ""}</div>
    <button class="btn primary" id="lnJoin">Join</button><button class="lnx" id="lnX" aria-label="Dismiss">×</button>`;
  document.body.appendChild(card);
  card.querySelector<HTMLButtonElement>("#lnJoin")!.onclick = () => { remember(c.liveRoom!); card!.remove(); goLive(c.liveRoom!); };
  card.querySelector<HTMLButtonElement>("#lnX")!.onclick = () => { remember(c.liveRoom!); card!.remove(); };
}

/** The card for a pop quiz that just arrived. Take it starts it in the recall sheet. */
function quizCard(q: Quiz) {
  if (getRole() !== "student") return;
  document.querySelector("#quizNotice")?.remove();
  const card = document.createElement("aside");
  card.id = "quizNotice"; card.className = "livenotice quiznotice";
  card.setAttribute("role", "status"); card.setAttribute("aria-label", `Pop quiz from ${q.className}`);
  card.innerHTML = `<span class="qnmark" aria-hidden="true">?</span><div class="lntext"><small>Pop quiz · ${esc(q.className)}${q.required ? " · required" : ""}</small><b>${esc(q.title)}</b><span>${q.questions.length} question${q.questions.length === 1 ? "" : "s"}${q.teacher ? ` from ${esc(q.teacher)}` : ""}</span></div>
    <button class="btn primary" id="qnGo">Take it</button><button class="lnx" id="qnX" aria-label="Later">×</button>`;
  document.body.appendChild(card);
  card.querySelector<HTMLButtonElement>("#qnGo")!.onclick = () => { card.remove(); dispatchEvent(new CustomEvent("lb-take-quiz", { detail: q.id })); };
  card.querySelector<HTMLButtonElement>("#qnX")!.onclick = () => card.remove();
}
