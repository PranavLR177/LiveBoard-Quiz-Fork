import { classroomUrl, getRole, isRole, setRole, type Role } from "./role";

/* DEVELOPMENT ONLY — remove before launch (delete this file and its two imports: src/main.ts and
   marker-slides/client.tsx), or build with VITE_DEV_SWITCH=0 to leave it out.
   A small "DEV" dot in the bottom-left corner of every screen. It opens three buttons that flip this device between
   Just me, Student and Teacher and take you to that side's home, plus "Welcome" to see the first-run dial again. */
const KEY = "liveboard-role";
const NAMES: Record<Role, string> = { individual: "Just me", student: "Student", teacher: "Teacher" };

export function installDevSwitch() {
  if (import.meta.env.VITE_DEV_SWITCH === "0" || document.getElementById("devSwitch")) return;
  if (import.meta.env.VITE_ARTIFACT && document.getElementById("classroom-root")) return; // the classroom's single-file preview has no other side to switch to
  const onClassroom = location.pathname.endsWith("/classroom.html");
  const notesHome = new URL(onClassroom ? "./" : location.pathname, location.href).pathname;
  const el = document.createElement("div");
  el.id = "devSwitch";
  el.innerHTML = `<style>
    #devSwitch{position:fixed;left:8px;bottom:8px;z-index:3000;display:flex;align-items:center;gap:4px;font:600 11px ui-monospace,Menlo,Consolas,monospace}
    #devSwitch button{border:1px solid #8884;background:#16131ff0;color:#fff;border-radius:99px;padding:5px 9px;font:inherit;cursor:pointer;line-height:1}
    #devSwitch .devdot{width:34px;height:24px;padding:0;background:#ff5d8f;border-color:#ff5d8f;color:#16131f;letter-spacing:.04em}
    #devSwitch button[aria-pressed="true"]{background:#fff;color:#16131f}
    #devSwitch .devopts{display:none;gap:4px}
    #devSwitch.open .devopts{display:flex}
    @media print{#devSwitch{display:none}}
  </style><button class="devdot" id="devDot" aria-expanded="false" title="Developer: switch between Just me, Student and Teacher (remove before launch)">DEV</button>
  <span class="devopts" role="group" aria-label="Developer: switch side">${(Object.keys(NAMES) as Role[]).map(r => `<button data-dev="${r}" aria-pressed="${getRole() === r}">${NAMES[r]}</button>`).join("")}<button data-dev="welcome" title="Forget the choice and show the welcome dial">Welcome</button></span>`;
  document.body.appendChild(el);
  const dot = el.querySelector<HTMLButtonElement>("#devDot")!;
  dot.onclick = () => dot.setAttribute("aria-expanded", String(el.classList.toggle("open")));
  el.querySelectorAll<HTMLButtonElement>("[data-dev]").forEach(b => b.onclick = () => {
    const to = b.dataset.dev!;
    if (to === "welcome") { try { localStorage.removeItem(KEY); } catch {} location.assign(notesHome); return; }
    if (!isRole(to)) return;
    if (to === "teacher" && import.meta.env.VITE_ARTIFACT) { dot.textContent = "n/a"; setTimeout(() => { dot.textContent = "DEV"; }, 1200); return; } // the preview holds one side per page
    setRole(to);
    location.assign(to === "teacher" ? classroomUrl("teacher") : notesHome);
  });
}
