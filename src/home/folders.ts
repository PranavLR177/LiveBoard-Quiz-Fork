import { course, liveNotes, newCourse, putCourse, safeColor } from "../store";
import { groupWord } from "../role";
import { esc } from "../util";
import type { Course, FolderBg } from "../types";
import { FOLDER_BGS, FOLDER_COLORS, FOLDER_ICONS, cleanFolder } from "./folderLook";

/* Folders you make yourself. A folder is one of your courses (or notebooks) given a look of its own: a name, a colour,
   a background and a mark on its tab. It sits on the dial just left of the pointer, outside the run of time, and holds
   every note in that course. Moving a note in is the course picker at the top of the note. */

/** The folder look as CSS custom properties and a data attribute, shared by the dial and the editor's preview. */
export const folderStyle = (color: string, bg: FolderBg) => `--fc:${safeColor(color)};--ft:${inkOn(safeColor(color))}" data-bg="${bg}`;

/** Dark text on light colours, white on dark ones. */
export function inkOn(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#1B1638" : "#fff";
}

/** Opens the folder maker. With a course it edits that folder. `done` gets the folder's course id (or null when the
 *  folder was taken off the dial). */
export function openFolderEditor(editId: string | null, done: (courseId: string | null) => void) {
  const cur = editId ? course(editId) : undefined;
  const look = cleanFolder(cur?.folder);
  const st = { name: cur?.name ? titleCase(cur.name) : "", color: safeColor(cur?.color || FOLDER_COLORS[(Date.now() / 1000 | 0) % FOLDER_COLORS.length]), bg: (look?.bg || "plain") as FolderBg, icon: look?.icon ?? "" };
  const count = cur ? liveNotes().filter(n => n.courseId === cur.id).length : 0;
  const wrap = document.createElement("div");
  wrap.className = "fedit-back";
  wrap.innerHTML = `<form class="fedit" role="dialog" aria-modal="true" aria-labelledby="feTitle">
    <h2 id="feTitle">${cur ? "Customize folder" : "New folder"}</h2>
    <div class="fedit-body">
      <div class="fedit-preview" aria-hidden="true"><div class="folder fsample" id="fePrev"><div class="fback"><span class="ftab"><i id="feTabIcon"></i></span></div><span class="file" style="--k:1"></span><span class="file" style="--k:0"></span><div class="ffront"><b id="feName"></b><span id="feCount">${count ? `${count} note${count === 1 ? "" : "s"}` : "Empty for now"}</span></div></div></div>
      <div class="fedit-fields">
        <label class="field">Name<input id="feNameIn" maxlength="32" required placeholder="e.g. Recipes, Side project, Spanish" autocomplete="off" value="${esc(st.name)}"></label>
        <fieldset><legend>Colour</legend><div class="fe-swatches" role="radiogroup" aria-label="Colour">${FOLDER_COLORS.map(c => `<button type="button" role="radio" class="fe-sw" data-color="${c}" style="--c:${c}" aria-label="${c}" aria-checked="false"></button>`).join("")}<label class="fe-sw fe-custom" title="Any colour"><input type="color" id="feColor" value="${st.color}" aria-label="Any colour"></label></div></fieldset>
        <fieldset><legend>Background</legend><div class="fe-bgs" role="radiogroup" aria-label="Background">${FOLDER_BGS.map(b => `<button type="button" role="radio" class="fe-bg" data-bg="${b.id}" aria-checked="false"><span class="fe-bgchip" data-bg="${b.id}"></span>${b.label}</button>`).join("")}</div></fieldset>
        <fieldset><legend>Mark on the tab</legend><div class="fe-icons" role="radiogroup" aria-label="Mark on the tab">${FOLDER_ICONS.map(i => `<button type="button" role="radio" class="fe-ic" data-icon="${esc(i)}" aria-label="${i ? esc(i) : "None"}" aria-checked="false">${i ? esc(i) : "–"}</button>`).join("")}</div></fieldset>
      </div>
    </div>
    <p class="muted small">${cur ? `It holds every note in this ${groupWord()}. Move a note in or out from the ${groupWord()} menu at the top of the note.` : `Move notes in from the ${groupWord()} menu at the top of a note.`}</p>
    <div class="fedit-acts">${cur ? `<button type="button" class="btn danger-quiet" id="feRemove">${count ? "Take off the dial" : "Delete folder"}</button>` : ""}<span></span><button type="button" class="btn" id="feCancel">Cancel</button><button class="btn primary" id="feSave">${cur ? "Save" : "Make folder"}</button></div>
  </form>`;
  document.body.appendChild(wrap);
  const $ = <T extends HTMLElement>(s: string) => wrap.querySelector<T>(s)!;
  const nameIn = $<HTMLInputElement>("#feNameIn");
  const paint = () => {
    const prev = $("#fePrev");
    prev.style.setProperty("--fc", st.color); prev.style.setProperty("--ft", inkOn(st.color)); prev.dataset.bg = st.bg;
    $("#feName").textContent = st.name.trim() || "New folder";
    $("#feTabIcon").textContent = st.icon;
    wrap.querySelectorAll<HTMLElement>(".fe-sw[data-color]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.color!.toLowerCase() === st.color.toLowerCase())));
    $(".fe-custom").classList.toggle("on", !FOLDER_COLORS.some(c => c.toLowerCase() === st.color.toLowerCase()));
    $(".fe-custom").style.setProperty("--c", st.color);
    wrap.querySelectorAll<HTMLElement>(".fe-bg").forEach(b => { b.setAttribute("aria-checked", String(b.dataset.bg === st.bg)); b.style.setProperty("--c", st.color); });
    wrap.querySelectorAll<HTMLElement>(".fe-ic").forEach(b => b.setAttribute("aria-checked", String(b.dataset.icon === st.icon)));
  };
  nameIn.oninput = () => { st.name = nameIn.value; paint(); };
  wrap.querySelectorAll<HTMLButtonElement>(".fe-sw[data-color]").forEach(b => b.onclick = () => { st.color = b.dataset.color!; paint(); });
  $<HTMLInputElement>("#feColor").oninput = e => { st.color = safeColor((e.target as HTMLInputElement).value); paint(); };
  wrap.querySelectorAll<HTMLButtonElement>(".fe-bg").forEach(b => b.onclick = () => { st.bg = b.dataset.bg as FolderBg; paint(); });
  wrap.querySelectorAll<HTMLButtonElement>(".fe-ic").forEach(b => b.onclick = () => { st.icon = b.dataset.icon!; paint(); });
  const close = () => { wrap.remove(); removeEventListener("keydown", esc_); };
  const esc_ = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", esc_);
  wrap.addEventListener("pointerdown", e => { if (e.target === wrap) close(); });
  $("#feCancel").onclick = close;
  $<HTMLFormElement>(".fedit").onsubmit = async e => {
    e.preventDefault();
    const name = st.name.trim();
    if (!name) { nameIn.focus(); return; }
    const folder = { bg: st.bg, icon: st.icon, at: look?.at || Date.now() };
    let id: string;
    if (cur) { await putCourse({ ...cur, name: name.slice(0, 32).toUpperCase(), color: st.color, folder }); id = cur.id; }
    else id = (await newCourse(name, { color: st.color, folder })).id;
    close(); done(id);
  };
  const rm = wrap.querySelector<HTMLButtonElement>("#feRemove");
  if (rm && cur) rm.onclick = async () => {
    // a folder with notes goes back to being a plain course and its notes return to the run of time;
    // an empty one is simply removed
    if (count) await putCourse({ ...cur, folder: null } as Course);
    else await putCourse({ ...cur, deleted: true });
    close(); done(null);
  };
  paint();
  setTimeout(() => nameIn.focus(), 30);
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());
