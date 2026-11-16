import { esc } from "./util";

/* Who LiveBoard is for on this device.
     individual  the notes app for anyone: no classes, exams or leaderboards; notebooks and a calendar
     student     the notes app with classes, exam countdowns, cram and live lessons
     teacher     the classroom: presentations, live classes, worksheets
   Kept per device until accounts carry it. A link with ?as=individual|student|teacher sets it (the classroom uses
   that to send someone back to the notes side). */
export type Role = "individual" | "student" | "teacher";
const ROLES: Role[] = ["individual", "student", "teacher"];
const KEY = "liveboard-role";
let memo: Role | null = null; // used when storage is blocked, so the choice still holds for this visit

export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);

export function getRole(): Role | null {
  try { const r = localStorage.getItem(KEY); if (isRole(r)) return r; } catch {}
  return memo;
}

export function setRole(r: Role) {
  memo = r;
  try { localStorage.setItem(KEY, r); } catch {}
  document.documentElement.dataset.role = r;
}

/** What a group of notes is called: a course at school, a notebook everywhere else. */
export const groupWord = (cap = false) => { const w = getRole() === "individual" ? "notebook" : "course"; return cap ? w[0].toUpperCase() + w.slice(1) : w; };

/** Reads ?as= from the address, saves it and removes it so a reload or bookmark doesn't repeat it. */
export function roleFromAddress() {
  const url = new URL(location.href);
  const as = url.searchParams.get("as");
  if (!isRole(as)) return;
  setRole(as);
  url.searchParams.delete("as");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

/** The classroom side (presentations, live classes), bundled with the app at /classroom.html on the same origin.
    It reads the same light/dark choice and storage, so the link carries nothing but which screen to open. */
export function classroomUrl(role: "student" | "teacher") {
  const url = new URL("classroom.html", location.href);
  url.search = ""; url.hash = "";
  url.searchParams.set("view", role === "student" ? "student" : "library");
  return url.href;
}

/* ---------- the welcome dial ----------
   The first screen is a dial, like the home screen it leads to: the choices sit on a ring, and whichever is turned to
   the pointer at the top is the one picked. Drag the ring, use the arrow keys, or tap a choice. First "Just me" or
   "Education"; Education turns the ring over to Student or Teacher. */
type Choice = { id: string; label: string; blurb: string; points: string[]; color: string; icon: string };
const ICON = {
  me: `<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-4 3.6-6 7.5-6s6.700 2 7.500 6"/>`,
  edu: `<path d="M2.500 9.500 12 5l9.500 4.500L12 14z"/><path d="M6.500 12v4.200c1.500 1.500 3.300 2.300 5.500 2.300s4-.8 5.500-2.300V12"/><path d="M21.500 9.500v5"/>`,
  student: `<path d="M5 4.500h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8.500h6"/>`,
  teacher: `<rect x="3" y="4.500" width="18" height="12" rx="2"/><path d="M12 16.500V20M8 20h8"/><path d="M7.500 12l3-3 2.500 2 3.500-3.500"/>`
};
const TOP: Choice[] = [
  { id: "individual", label: "Just me", blurb: "Notes for work, projects and life.", points: ["Markers that explain, tidy and calculate", "Notebooks instead of folders", "A calendar for deadlines and reminders"], color: "var(--g5)", icon: ICON.me },
  { id: "education", label: "Education", blurb: "For a class: learning in one, or teaching one.", points: ["Students: lecture notes, recall, exam countdowns", "Teachers: presentations and live classes"], color: "var(--g7)", icon: ICON.edu }
];
const EDU: Choice[] = [
  { id: "student", label: "Student", blurb: "Notes that quiz you on what you marked.", points: ["Import a lecture or start a blank page", "Morning recall, streaks and cram for exams", "Join your teacher's live lessons by code"], color: "var(--g4)", icon: ICON.student },
  { id: "teacher", label: "Teacher", blurb: "Teach from slides your students can mark.", points: ["Presentations and a slide editor", "Live classes students join by code", "Worksheets from your PDFs"], color: "var(--g2)", icon: ICON.teacher }
];

/** The first-run choice. Resolves with the role picked. */
export function pickRole(): Promise<Role> {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "welcome";
    wrap.innerHTML = `<div class="wcard" role="dialog" aria-modal="true" aria-labelledby="wTitle" tabindex="-1">
      <div class="whead"><h1 id="wTitle">Welcome to LiveBoard</h1><p class="muted" id="wStep">Turn the dial to how you'll use it.</p></div>
      <div class="wdial" id="wDial"><span class="wpointer" aria-hidden="true"></span>
        <div class="wring" id="wRing" role="radiogroup" aria-label="How you'll use LiveBoard"></div>
        <div class="whub" id="wHub" aria-live="polite"></div></div>
      <ul class="wpoints" id="wPoints"></ul>
      <p class="muted small wfoot"><button class="linkbtn" id="wBack" hidden>← Back</button><span id="wNote">You can change this later in Settings.</span></p>
    </div>`;
    document.body.appendChild(wrap);
    const ring = wrap.querySelector<HTMLElement>("#wRing")!, hub = wrap.querySelector<HTMLElement>("#wHub")!, dial = wrap.querySelector<HTMLElement>("#wDial")!;
    const back = wrap.querySelector<HTMLButtonElement>("#wBack")!, step = wrap.querySelector<HTMLElement>("#wStep")!;
    let set = TOP, sel = 0, turn = 0; // turn: the ring's rotation in degrees; choice i sits at i * (360 / n) around it
    const slice = () => 360 / set.length;
    const paint = (animate = true) => {
      ring.style.transition = animate ? "" : "none";
      ring.style.transform = `rotate(${turn}deg)`;
      ring.querySelectorAll<HTMLElement>(".wopt").forEach((o, i) => {
        o.style.transform = `rotate(${i * slice()}deg) translateY(calc(var(--wr) * -1)) rotate(${-i * slice() - turn}deg)`;
        o.setAttribute("aria-checked", String(i === sel)); o.tabIndex = i === sel ? 0 : -1;
      });
      const c = set[sel];
      wrap.style.setProperty("--wc", c.color);
      wrap.querySelector<HTMLElement>("#wPoints")!.innerHTML = c.points.map(p => `<li>${esc(p)}</li>`).join("");
      hub.innerHTML = `<b class="wname">${esc(c.label)}</b><span class="wblurb">${esc(c.blurb)}</span>
        <button class="btn primary wgo" id="wGo">${c.id === "education" ? "Next" : "Continue"}</button>
        ${set === EDU && !import.meta.env.VITE_ARTIFACT ? `<a class="wjoin" href="${esc(classroomUrl("student"))}">Just joining a class? Enter a code →</a>` : ""}`;
      hub.querySelector<HTMLButtonElement>("#wGo")!.onclick = go;
    };
    const build = () => {
      ring.innerHTML = set.map((c, i) => `<button class="wopt" role="radio" data-i="${i}" style="--oc:${c.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c.icon}</svg><span>${esc(c.label)}</span></button>`).join("");
      back.hidden = set === TOP;
      step.textContent = set === TOP ? "Turn the dial to how you'll use it." : "Learning in a class, or teaching one?";
    };
    /** Turns the shortest way round to choice i. */
    const select = (i: number) => {
      sel = (i + set.length) % set.length;
      const want = -sel * slice();
      turn += ((want - turn) % 360 + 540) % 360 - 180;
      paint();
    };
    function go() {
      const c = set[sel];
      if (c.id === "education") { set = EDU; sel = 0; build(); paint(false); void ring.offsetWidth; spin(-1); wrap.querySelector<HTMLElement>(".wopt")!.focus(); return; } // the ring swings round with the next choices
      const r = c.id as Role;
      setRole(r);
      wrap.classList.add("leaving");
      setTimeout(() => { wrap.remove(); resolve(r); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
    }
    /** Swings at least half a turn in one direction and lands on the current choice. */
    const spin = (dir: 1 | -1) => {
      const want = -sel * slice();
      turn = dir < 0 ? want + 360 * Math.floor((turn - 180 - want) / 360) : want + 360 * Math.ceil((turn + 180 - want) / 360);
      paint();
    };
    back.onclick = () => { set = TOP; sel = 1; build(); paint(false); void ring.offsetWidth; spin(1); wrap.querySelector<HTMLElement>(".wopt[aria-checked=true]")!.focus(); };
    ring.addEventListener("click", e => { const o = (e.target as HTMLElement).closest<HTMLElement>(".wopt"); if (o && !dragged) { const i = +o.dataset.i!; if (i === sel) go(); else select(i); } });
    wrap.addEventListener("keydown", e => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); select(sel + 1); ring.querySelector<HTMLElement>(".wopt[aria-checked=true]")!.focus(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); select(sel - 1); ring.querySelector<HTMLElement>(".wopt[aria-checked=true]")!.focus(); }
      else if (e.key === "Escape" && set === EDU) back.click();
    });
    // dragging the ring turns it; letting go settles on the nearest choice
    let dragged = false, start: { a: number; turn: number } | null = null;
    const angle = (e: PointerEvent) => { const r = dial.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    dial.addEventListener("pointerdown", e => { if ((e.target as HTMLElement).closest(".whub")) return; start = { a: angle(e), turn }; dragged = false; });
    addEventListener("pointermove", e => {
      if (!start || !wrap.isConnected) return;
      let d = angle(e) - start.a; d = ((d + 540) % 360) - 180;
      if (Math.abs(d) > 4) dragged = true;
      if (dragged) { turn = start.turn + d; paint(false); }
    });
    addEventListener("pointerup", () => {
      if (!start || !wrap.isConnected) return;
      start = null;
      if (dragged) { select(Math.round(-turn / slice())); setTimeout(() => { dragged = false; }, 0); }
    });
    dial.addEventListener("wheel", e => { e.preventDefault(); if (Math.abs(e.deltaY) + Math.abs(e.deltaX) > 12 && !wheelLock) { wheelLock = true; select(sel + (e.deltaY + e.deltaX > 0 ? 1 : -1)); setTimeout(() => { wheelLock = false; }, 320); } }, { passive: false });
    let wheelLock = false;
    build(); paint(false);
    wrap.querySelector<HTMLElement>(".wcard")!.focus(); // focus the dialog, not a choice
  });
}
