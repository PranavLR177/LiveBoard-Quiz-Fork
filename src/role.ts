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
export function classroomUrl(role: "student" | "teacher", room?: { code: string; name?: string }) {
  const url = new URL("classroom.html", location.href);
  url.search = ""; url.hash = "";
  url.searchParams.set("view", role === "student" ? "student" : "library");
  if (room) { url.searchParams.set("room", room.code); if (room.name) url.searchParams.set("name", room.name); }
  return url.href;
}

/* ---------- the welcome dial ----------
   The first screen is a dial, like the home screen it leads to. The choices sit side by side at the top of the ring,
   the way notes and folders do on the home dial. One click turns a choice to the pointer and lights it up; a second
   click on it goes in. (Arrow keys and dragging turn the ring too; Enter goes in.) First "Just me" or "Education";
   Education turns the ring over to Student or Teacher. */
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
      <div class="whead"><h1 id="wTitle">Welcome to LiveBoard</h1><p class="muted" id="wStep"></p></div>
      <div class="wdial" id="wDial"><span class="wpointer" aria-hidden="true"></span>
        <div class="wring" id="wRing" role="group" aria-label="How you'll use LiveBoard"></div>
        <div class="whub" id="wHub" aria-live="polite"></div></div>
      <ul class="wpoints" id="wPoints"></ul>
      <p class="muted small wfoot"><button class="linkbtn" id="wBack" hidden>← Back</button><span id="wNote">You can change this later in Settings.</span></p>
    </div>`;
    document.body.appendChild(wrap);
    const ring = wrap.querySelector<HTMLElement>("#wRing")!, hub = wrap.querySelector<HTMLElement>("#wHub")!, dial = wrap.querySelector<HTMLElement>("#wDial")!;
    const back = wrap.querySelector<HTMLButtonElement>("#wBack")!, step = wrap.querySelector<HTMLElement>("#wStep")!, points = wrap.querySelector<HTMLElement>("#wPoints")!;
    const GAP = 42; // degrees between neighbouring choices: close enough to read as a pair, far enough not to touch
    let set = TOP, sel = -1, turn = 0; // sel -1: nothing lit yet. turn: the ring's rotation in degrees
    const at = (i: number) => (i - (set.length - 1) / 2) * GAP; // where choice i sits on the ring, 0 being the top
    const touch = matchMedia("(hover: none)").matches;
    const paint = (animate = true) => {
      ring.classList.toggle("still", !animate);
      ring.querySelectorAll<HTMLElement>(".wopt").forEach((o, i) => {
        o.style.transform = `rotate(${at(i) + turn}deg) translateY(calc(var(--wr) * -1)) rotate(${-at(i) - turn}deg)`;
        o.setAttribute("aria-pressed", String(i === sel));
        o.setAttribute("aria-label", `${set[i].label}. ${set[i].blurb} ${i === sel ? "Press again to continue." : ""}`);
      });
      const c = set[sel];
      wrap.style.setProperty("--wc", c ? c.color : "var(--line)");
      points.innerHTML = (c ? c.points : []).map(p => `<li>${esc(p)}</li>`).join("");
      hub.innerHTML = c
        ? `<b class="wname">${esc(c.label)}</b><span class="wblurb">${esc(c.blurb)}</span><span class="wagain">${touch ? "Tap" : "Click"} it again to ${c.id === "education" ? "choose" : "open"}</span>`
        : `<b class="wname wask">${set === TOP ? "Who's it for?" : "Which one?"}</b><span class="wblurb">${touch ? "Tap" : "Click"} one to see it. ${touch ? "Tap" : "Click"} again to go in.</span>
           ${set === EDU && !import.meta.env.VITE_ARTIFACT ? `<a class="wjoin" href="${esc(classroomUrl("student"))}">Just joining a class? Enter a code →</a>` : ""}`;
    };
    const build = () => {
      ring.innerHTML = set.map((c, i) => `<button class="wopt" data-i="${i}" style="--oc:${c.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${c.icon}</svg><span>${esc(c.label)}</span></button>`).join("");
      back.hidden = set === TOP;
      step.textContent = set === TOP ? "Just for you, or for a class?" : "Learning in a class, or teaching one?";
    };
    /** Turns choice i to the pointer and lights it. */
    const select = (i: number) => { sel = Math.max(0, Math.min(set.length - 1, i)); turn = -at(sel); paint(); };
    /** Swaps in another set of choices with a full turn of the ring, nothing lit. */
    const swap = (next: Choice[], dir: 1 | -1) => {
      set = next; sel = -1; build();
      turn = dir * 360; paint(false); void ring.offsetWidth; // start a full turn away, then let it swing home
      turn = 0; paint();
    };
    function go() {
      const c = set[sel];
      if (!c) return;
      if (c.id === "education") { swap(EDU, -1); wrap.querySelector<HTMLElement>(".wopt")!.focus(); return; }
      const r = c.id as Role;
      setRole(r);
      wrap.classList.add("leaving");
      setTimeout(() => { wrap.remove(); resolve(r); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
    }
    back.onclick = () => { swap(TOP, 1); select(1); ring.querySelector<HTMLElement>('.wopt[aria-pressed="true"]')!.focus(); };
    ring.addEventListener("click", e => { const o = (e.target as HTMLElement).closest<HTMLElement>(".wopt"); if (o && !dragged) { const i = +o.dataset.i!; if (i === sel) go(); else select(i); } });
    wrap.addEventListener("keydown", e => {
      const move = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (move) { e.preventDefault(); select(sel < 0 ? (move > 0 ? 0 : set.length - 1) : sel + move); ring.querySelector<HTMLElement>('.wopt[aria-pressed="true"]')!.focus(); }
      else if (e.key === "Enter" && sel >= 0 && !(e.target as HTMLElement).closest(".wopt, a, button")) { e.preventDefault(); go(); }
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
      if (dragged) { turn = Math.max(-at(set.length - 1) - 25, Math.min(-at(0) + 25, start.turn + d)); paint(false); }
    });
    addEventListener("pointerup", () => {
      if (!start || !wrap.isConnected) return;
      start = null;
      if (dragged) { let best = 0; set.forEach((_, i) => { if (Math.abs(at(i) + turn) < Math.abs(at(best) + turn)) best = i; }); select(best); setTimeout(() => { dragged = false; }, 0); }
    });
    build(); paint(false);
    wrap.querySelector<HTMLElement>(".wcard")!.focus(); // focus the dialog, not a choice
  });
}
