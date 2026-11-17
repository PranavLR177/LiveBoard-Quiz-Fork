import type { ClassPing, MyClass } from "../sync";
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
  if (getRole() !== "student" || !src.signedIn()) { unsubscribe?.(); unsubscribe = null; list = []; show(null); return; }
  if (unsubscribe && !again) return;
  if (!unsubscribe) unsubscribe = src.subscribe(ping);
  await refresh();
}

async function refresh() {
  if (asking) return;
  asking = true;
  try { const got = await src.myClasses(); if (got) { list = got; tell(); } } finally { asking = false; }
}

function ping(p: ClassPing) {
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
