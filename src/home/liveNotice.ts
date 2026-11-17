import type { MyClass } from "../sync";
import { classes as src } from "../classSource";
import { getRole } from "../role";
import { esc } from "../util";
import { goLive } from "./classes";

/* When a teacher starts a live lesson for one of your classes, a card slides in at the side of the screen with a
   button into it. It checks every half minute while LiveBoard is open and looked at, only for a signed-in student.
   Dismissing it hides that lesson for good on this device; the Classes screen still shows it as live. */

const SEEN = "lb-live-dismissed";
const seen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(SEEN) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; } };
const remember = (room: string) => { try { localStorage.setItem(SEEN, JSON.stringify([room, ...seen()].slice(0, 30))); } catch { /* storage blocked */ } };

let timer: ReturnType<typeof setInterval> | null = null, checking = false;

export function startLiveNotices() {
  if (timer) return;
  const tick = () => { if (document.visibilityState === "visible") void check(); };
  timer = setInterval(tick, 30000);
  document.addEventListener("visibilitychange", tick);
  addEventListener("hashchange", () => { if (location.hash === "#classes") show(null); else tick(); });
  setTimeout(tick, 1500);
}

/** Looks now (also used right after signing in). */
export async function check() {
  await src.ready();
  if (checking || getRole() !== "student" || !src.signedIn()) { if (getRole() !== "student") show(null); return; }
  checking = true;
  try {
    const list = await src.myClasses();
    if (!list) return;
    const off = seen();
    if (location.hash === "#classes") { show(null); return; } // the Classes screen shows the lesson itself
    show(list.find(c => c.liveRoom && !off.includes(c.liveRoom)) || null);
  } finally { checking = false; }
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
