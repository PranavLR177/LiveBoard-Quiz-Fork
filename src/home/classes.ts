import { course, liveCourses, liveMarkers, liveNotes, newCourse, putCourse, putMeta, safeColor, state } from "../store";
import type { ClassPreview, MyClass } from "../sync";
import { classes as src } from "../classSource";
import { isDue, recallable } from "../study";
import { classroomUrl } from "../role";
import { openClassroom } from "../classroom/open";
import { $, esc, reducedMotion, toast } from "../util";
import type { Course } from "../types";

/* Classes, for a student: a binder. Each class is a divider with a coloured tab down the right edge; choosing a tab
   turns the binder to that class's page: the live lesson if one is running, your notes for it, how you're doing and
   the class's week. The last tab is a blank page for joining, and one code box takes both kinds of code:
     6 characters  a class (from a teacher or a classmate). Joining a teacher's class shares the course you link
                   with that teacher, read-only, so it asks first. Leaving stops it.
     8 characters  a live lesson, which needs no account at all. */

type Handlers = { openNote: (id: string) => void; newBlank: (courseId?: string) => void; openSettings: (section?: string) => void; home: () => void };
type View = { list: MyClass[] | null; failed: boolean; sel: string; preview: { code: string; info: ClassPreview } | null; leaving: boolean };

const PALETTE = ["#E8590C", "#7048E8", "#1C7ED6", "#0CA678", "#D6336C", "#F59F00", "#3B5BDB", "#2B8A3E"];
const hashColor = (s: string) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const JOIN = "join";

/** Into a live lesson. The single-file preview carries the classroom inside the page, without codes. */
export function goLive(code: string) {
  if (import.meta.env.VITE_ARTIFACT) { void openClassroom("student"); return; }
  location.assign(classroomUrl("student", { code, name: state.meta.displayName || undefined }));
}

/** The local course a class is linked to: the one the server remembers, else one marked with the class's id. */
const linked = (c: MyClass): Course | undefined => {
  const byServer = c.courseId ? course(c.courseId) : undefined;
  if (byServer && !byServer.deleted) return byServer;
  return liveCourses().find(x => x.classId === c.id);
};
const colorOf = (c: MyClass) => { const lc = linked(c); return lc ? safeColor(lc.color) : hashColor(c.name); };
const live = (c: MyClass) => !!c.liveRoom;

export function renderClasses(root: HTMLElement, h: Handlers): () => void {
  let alive = true;
  const v: View = { list: null, failed: false, sel: "", preview: null, leaving: false };
  
  root.innerHTML = `<div class="binder-screen"><header class="binder-top">
      <button class="btn ghost" id="bHome" aria-label="Back to your notes"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Notes</button>
      <h1>Classes</h1><span class="muted small" id="bSub"></span></header>
    <div class="binder" id="binder"><article class="bpage" id="bPage" aria-live="polite"></article><nav class="btabs" id="bTabs" role="tablist" aria-label="Your classes" aria-orientation="vertical"></nav></div></div>`;
  $("#bHome", root)!.onclick = h.home;

  const signedIn = () => src.signedIn();
  let chosen = false;
  const pick = (id: string) => {
    chosen = true;
    if (id === v.sel) return;
    v.sel = id; v.preview = null; v.leaving = false;
    paint(true);
  };

  async function load() {
    await src.ready();
    if (!alive) return;
    if (!signedIn()) { v.list = []; v.failed = false; paint(); return; }
    const list = await src.myClasses();
    if (!alive) return;
    v.failed = list === null;
    if (list) {
      v.list = list;
      // a class that's gone (deleted, or left on another device) no longer marks the course here
      for (const c of liveCourses()) if (c.classId && !list.some(x => x.id === c.classId)) await putCourse({ ...c, classId: null, classCode: null });
    }
    paint();
  }

  function paint(turn = false) {
    if (!alive) return;
    const list = v.list || [];
    // until a tab is chosen, the binder opens on a live class, else the first one (the join page while loading)
    if (!list.some(c => c.id === v.sel) && !(v.sel === JOIN && chosen)) v.sel = list.find(live)?.id || list[0]?.id || JOIN;
    const tabs = $("#bTabs", root)!;
    tabs.innerHTML = list.map((c, i) => `<button role="tab" class="btab${live(c) ? " live" : ""}" data-id="${esc(c.id)}" style="--cc:${colorOf(c)};--i:${i}" aria-selected="${c.id === v.sel}" tabindex="${c.id === v.sel ? 0 : -1}" title="${esc(c.name)}"><span>${esc(c.name)}</span>${live(c) ? `<i class="bdot" aria-label="live now"></i>` : ""}</button>`).join("")
      + `<button role="tab" class="btab bjoin" data-id="${JOIN}" style="--i:${list.length}" aria-selected="${v.sel === JOIN}" tabindex="${v.sel === JOIN ? 0 : -1}"><span>+ Join</span></button>`;
    tabs.querySelectorAll<HTMLButtonElement>(".btab").forEach(b => b.onclick = () => pick(b.dataset.id!));
    tabs.onkeydown = e => {
      const all = [...tabs.querySelectorAll<HTMLButtonElement>(".btab")], i = all.findIndex(b => b.dataset.id === v.sel);
      const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = all[(i + d + all.length) % all.length];
      pick(next.dataset.id!); tabs.querySelector<HTMLButtonElement>(`.btab[data-id="${CSS.escape(next.dataset.id!)}"]`)?.focus();
    };
    const n = list.length;
    $("#bSub", root)!.textContent = !signedIn() ? "" : v.list === null ? "Loading…" : n ? `${n} class${n === 1 ? "" : "es"}${list.some(live) ? " · one is live now" : ""}` : "";
    const page = $("#bPage", root)!;
    const c = list.find(x => x.id === v.sel);
    page.style.setProperty("--cc", c ? colorOf(c) : "var(--ink-3, #8892A0)");
    page.dataset.kind = c ? c.kind : "join";
    if (v.list === null) { page.dataset.kind = "join"; page.innerHTML = `<span class="brings" aria-hidden="true"><i></i><i></i><i></i></span><p class="muted">Opening your binder…</p>`; return; }
    page.innerHTML = c ? classPage(c) : joinPage();
    if (turn && !reducedMotion()) page.animate([{ transform: "perspective(1400px) rotateY(-14deg) translateX(18px)", opacity: 0.35, transformOrigin: "left center" }, { transform: "none", opacity: 1, transformOrigin: "left center" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    if (c) wireClass(page, c); else wireJoin(page);
  }

  /* ---------- a class's page ---------- */
  function classPage(c: MyClass) {
    const lc = linked(c);
    const notes = lc ? liveNotes().filter(x => x.courseId === lc.id).sort((a, b) => b.updatedAt - a.updatedAt) : [];
    const ids = new Set(notes.map(x => x.id));
    const ms = liveMarkers().filter(m => ids.has(m.noteId));
    const mastered = ms.filter(m => m.mastery === 2).length, getting = ms.filter(m => m.mastery === 1).length;
    const due = ms.filter(m => recallable(m) && isDue(m)).length;
    const pct = ms.length ? Math.round(100 * mastered / ms.length) : 0;
    const who = c.kind === "teacher" ? (c.teacher ? esc(c.teacher) + "'s class" : "Teacher's class") : "Study group";
    const ago = (t: number) => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString(); };
    return `<span class="brings" aria-hidden="true"><i></i><i></i><i></i></span>
      <header class="bhead"><span class="eyebrow">${who}</span><h2>${esc(c.name)}</h2>
        <p class="bmeta"><span class="bcode" title="Class code">${esc(c.code)}</span><span>${c.students} ${c.students === 1 ? "person" : "people"}</span>${lc ? `<span class="bcourse"><i style="background:${safeColor(lc.color)}"></i>${esc(lc.name)}</span>` : ""}</p></header>
      ${live(c) ? `<section class="blive" aria-label="Live lesson"><span class="bpulse" aria-hidden="true"></span><div><b>Live now</b><span>${esc(c.liveTitle || "A lesson")}${c.teacher ? " · " + esc(c.teacher) : ""}</span></div><a class="btn primary" id="bLive" href="${esc(classroomUrl("student", { code: c.liveRoom!, name: state.meta.displayName || undefined }))}">Join the lesson</a></section>` : ""}
      <div class="bgrid">
        <section class="bcard bnotes"><h3>Your notes${notes.length ? ` <small>${notes.length}</small>` : ""}</h3>
          ${!lc ? `<p class="muted small">This class isn't linked to one of your courses on this device yet.</p>`
            : notes.length ? `<ul>${notes.slice(0, 7).map(x => { const k = liveMarkers().filter(m => m.noteId === x.id).length; return `<li><button data-note="${esc(x.id)}"><b>${esc(x.title || "Untitled note")}</b><small>${ago(x.updatedAt)}${k ? ` · ${k} marker${k === 1 ? "" : "s"}` : ""}</small></button></li>`; }).join("")}</ul>${notes.length > 7 ? `<p class="muted small">and ${notes.length - 7} more on the dial.</p>` : ""}`
            : `<p class="muted small">Nothing yet. Notes you take in ${esc(lc.name)} show up here.</p>`}
          ${lc ? `<button class="btn" id="bNew">New note for ${esc(c.name)}</button>` : ""}</section>
        <section class="bcard bprog"><h3>How you're doing</h3>
          ${ms.length ? `<div class="bring" style="--p:${pct}"><b>${pct}%</b><small>mastered</small></div>
            <ul class="bstat"><li><i class="m2"></i>${mastered} mastered</li><li><i class="m1"></i>${getting} getting there</li><li><i class="m0"></i>${ms.length - mastered - getting} unsure</li></ul>
            <p class="small ${due ? "" : "muted"}">${due ? `<b>${due}</b> to recall today. Start it from the dial.` : "Nothing due today."}</p>`
            : `<p class="muted small">Mark a passage in a note for this class and it becomes a recall question here.</p>`}</section>
        <section class="bcard bweek"><h3>This week</h3><div id="bBoard" class="bboard">Loading…</div></section>
      </div>
      <footer class="bfoot">${c.kind === "teacher"
        ? `<p class="small">${c.shares && lc ? `${c.teacher ? esc(c.teacher) : "Your teacher"} can read your notes and markers in <b>${esc(lc.name)}</b>, not the rest of your notes. Leaving stops it.` : "You're in this class without sharing notes."}</p>`
        : `<p class="small muted">A study group shares points on the leaderboard, never notes.</p>`}
        ${v.leaving ? `<span class="bconfirm">Leave ${esc(c.name)}? Your notes stay yours. <button class="btn danger-quiet" id="bLeaveYes">Leave class</button><button class="btn" id="bLeaveNo">Stay</button></span>` : `<button class="linkbtn" id="bLeave">Leave class…</button>`}</footer>`;
  }

  function wireClass(page: HTMLElement, c: MyClass) {
    page.querySelectorAll<HTMLButtonElement>("[data-note]").forEach(b => b.onclick = () => h.openNote(b.dataset.note!));
    const lc = linked(c);
    const nb = page.querySelector<HTMLButtonElement>("#bNew"); if (nb && lc) nb.onclick = () => h.newBlank(lc.id);
    const leave = page.querySelector<HTMLButtonElement>("#bLeave"); if (leave) leave.onclick = () => { v.leaving = true; paint(); };
    const no = page.querySelector<HTMLButtonElement>("#bLeaveNo"); if (no) no.onclick = () => { v.leaving = false; paint(); };
    const yes = page.querySelector<HTMLButtonElement>("#bLeaveYes");
    if (yes) yes.onclick = async () => {
      yes.disabled = true;
      try {
        await src.leaveClass(c.id);
        for (const x of liveCourses()) if (x.classId === c.id) await putCourse({ ...x, classId: null, classCode: null });
        toast(`You left ${c.name}.`);
        v.leaving = false; v.sel = ""; await load();
      } catch (e) { toast((e as Error).message); yes.disabled = false; }
    };
    void src.leaderboard(c.id).then(rows => {
      const box = page.querySelector<HTMLElement>("#bBoard");
      if (!alive || !box || !box.isConnected) return;
      if (!rows) { box.textContent = "Couldn't load the week."; return; }
      if (!rows.length) { box.innerHTML = `<p class="muted small">No recall answers this week yet. Yours count from your first one.</p>`; return; }
      const top = Math.max(1, ...rows.map(r => r.points));
      box.innerHTML = rows.slice(0, 8).map((r, i) => `<div class="brow${r.is_me ? " me" : ""}"><span class="n">${i + 1}</span><span class="nm">${esc(r.display_name)}${r.is_me ? " (you)" : ""}</span><i style="--w:${Math.round(100 * r.points / top)}%"></i><b>${r.points}</b></div>`).join("")
        + `<p class="muted small">Points come from recall answers.</p>`;
    });
  }

  /* ---------- the join page ---------- */
  function joinPage() {
    const p = v.preview;
    if (p) {
      const free = liveCourses().filter(x => !x.classId);
      const teacher = p.info.kind === "teacher";
      return `<span class="brings" aria-hidden="true"><i></i><i></i><i></i></span>
        <header class="bhead"><span class="eyebrow">${teacher ? (p.info.teacher ? esc(p.info.teacher) + "'s class" : "Teacher's class") : "Study group"}</span><h2>${esc(p.info.name)}</h2>
          <p class="bmeta"><span class="bcode">${esc(p.code)}</span><span>${p.info.students} ${p.info.students === 1 ? "person" : "people"} so far</span></p></header>
        <form class="bjoinform" id="bConfirm">
          ${state.meta.displayName ? "" : `<label class="field">Your name, as the class sees it<input id="bName" required maxlength="40" autocomplete="given-name" placeholder="First name"></label>`}
          <label class="field">Keep this class's notes in<select id="bCourse"><option value="">A new course: ${esc(p.info.name)}</option>${free.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label>
          ${teacher ? `<label class="bconsent"><input type="checkbox" id="bShare" required><span>Share the notes and markers in this course with ${p.info.teacher ? esc(p.info.teacher) : "the teacher"}, read-only. Nothing else in LiveBoard is shared, and leaving the class stops it.</span></label>` : `<p class="muted small">Classmates see your name and recall points on the leaderboard. Your notes stay private.</p>`}
          <div class="bacts"><button type="button" class="btn" id="bBack">Back</button><button class="btn primary">Join ${esc(p.info.name)}</button></div>
        </form>`;
    }
    const can = src.configured(), inn = signedIn();
    return `<span class="brings" aria-hidden="true"><i></i><i></i><i></i></span>
      <header class="bhead"><span class="eyebrow">A new divider</span><h2>Join with a code</h2></header>
      <form class="bcodeform" id="bCodeForm" autocomplete="off">
        <input id="bCode" class="bcodein" maxlength="8" spellcheck="false" autocapitalize="characters" aria-label="Class or lesson code" placeholder="CODE" inputmode="text">
        <button class="btn primary" id="bGo" disabled>Go</button>
      </form>
      <p class="bhint" id="bHint">A <b>6-letter</b> code joins a class. An <b>8-letter</b> code joins a live lesson that's on right now.</p>
      ${!can ? `<p class="muted small">Classes need LiveBoard accounts, which this copy isn't connected to. Live lessons by code still work.</p>`
        : !inn ? `<div class="bsignin"><p class="small">Sign in to join classes: they live on your account, so you see them on every device. Live lessons work without signing in.</p><button class="btn" id="bSignIn">Sign in</button></div>`
        : v.failed ? `<p class="muted small">Couldn't reach your classes just now. <button class="linkbtn" id="bRetry">Try again</button></p>`
        : !(v.list || []).length ? `<p class="muted small">You're not in any classes yet. Your teacher, or a classmate who made a study group, has the code.</p>` : ""}`;
  }

  function wireJoin(page: HTMLElement) {
    const si = page.querySelector<HTMLButtonElement>("#bSignIn"); if (si) si.onclick = () => h.openSettings("account");
    const rt = page.querySelector<HTMLButtonElement>("#bRetry"); if (rt) rt.onclick = () => void load();
    const back = page.querySelector<HTMLButtonElement>("#bBack"); if (back) back.onclick = () => { v.preview = null; paint(); };
    const confirm = page.querySelector<HTMLFormElement>("#bConfirm");
    if (confirm && v.preview) confirm.onsubmit = async e => {
      e.preventDefault();
      const p = v.preview!, btn = confirm.querySelector<HTMLButtonElement>("button.primary")!;
      const nameIn = confirm.querySelector<HTMLInputElement>("#bName");
      const share = !!confirm.querySelector<HTMLInputElement>("#bShare")?.checked;
      if (p.info.kind === "teacher" && !share) return;
      btn.disabled = true;
      try {
        if (nameIn) await putMeta({ displayName: nameIn.value.trim().slice(0, 40) });
        const chosen = confirm.querySelector<HTMLSelectElement>("#bCourse")!.value;
        const c = chosen ? course(chosen)! : await newCourse(p.info.name);
        const r = await src.joinClass(p.code, state.meta.displayName || "Student", c.id, p.info.kind === "teacher" && share);
        await putCourse({ ...course(c.id)!, classId: r.id, classCode: r.code });
        toast(`You're in ${r.name}.`);
        v.preview = null; v.sel = r.id; await load();
      } catch (err) { toast((err as Error).message); btn.disabled = false; }
    };
    const form = page.querySelector<HTMLFormElement>("#bCodeForm");
    if (!form) return;
    const input = form.querySelector<HTMLInputElement>("#bCode")!, go = form.querySelector<HTMLButtonElement>("#bGo")!, hint = page.querySelector<HTMLElement>("#bHint")!;
    const say = () => {
      const code = input.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
      if (code !== input.value) input.value = code;
      go.disabled = !(code.length === 6 || code.length === 8);
      hint.innerHTML = code.length === 8 ? "That's a live lesson code. <b>Go</b> takes you in." : code.length === 6 ? (signedIn() ? "That's a class code. <b>Go</b> shows you the class before you join." : "That's a class code. Sign in first to join a class.") : "A <b>6-letter</b> code joins a class. An <b>8-letter</b> code joins a live lesson that's on right now.";
    };
    input.oninput = say;
    form.onsubmit = async e => {
      e.preventDefault();
      const code = input.value.trim().toUpperCase();
      if (code.length === 8) { goLive(code); return; }
      if (code.length !== 6) return;
      if (!signedIn()) { h.openSettings("account"); return; }
      go.disabled = true;
      try {
        const info = await src.classPreview(code);
        if (!alive) return;
        if (!info) { hint.textContent = "No class has that code. Check it with your teacher."; return; }
        const already = (v.list || []).find(x => x.code === code);
        if (already) { pick(already.id); return; }
        v.preview = { code, info }; paint();
      } catch (err) { hint.textContent = (err as Error).message; }
      finally { if (input.isConnected) go.disabled = false; }
    };
    setTimeout(() => { if (input.isConnected && !matchMedia("(hover: none)").matches) input.focus(); }, 40);
  }

  paint();
  void load();
  // a teacher starting a lesson shows up here without a reload
  const poll = setInterval(() => { if (document.visibilityState === "visible" && !v.preview && !v.leaving) void load(); }, 30000);
  return () => { alive = false; clearInterval(poll); };
}
