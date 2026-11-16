import { liveCourses } from "../store";
import { addDeadline, agenda, dateKey, daysUntil, removeDeadline, setDeadlineDone, todayKey, type AgendaItem } from "../deadlines";
import { groupWord } from "../role";
import { esc } from "../util";

/* The calendar chip on the home screen's top line, for anyone taking notes. One place for everything with a date:
   deadlines you add here, reminders you set from a marker ("remind me Friday"), and a student's exams. */

let month = new Date(); month.setDate(1);
let picked: string | null = null; // a day tapped in the grid: the list and the add form follow it

const when = (date: string) => { const d = daysUntil(date); return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d > 0 ? (d < 14 ? `in ${d} days` : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : `${-d} days late`; };
const ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.500"/><path d="M2 6.500h12M5.500 1.500v3M10.500 1.500v3"/></svg>`;

/** What still needs doing: not ticked off, today or later, or late. */
const open = (list: AgendaItem[]) => list.filter(x => !x.done && (x.kind === "deadline" || daysUntil(x.date) >= 0));

export function calendarChip(isOpen: boolean): string {
  const all = agenda(), todo = open(all);
  const late = todo.filter(x => daysUntil(x.date) < 0).length;
  const next = todo.find(x => daysUntil(x.date) >= 0) || todo[0];
  const label = next ? `<b class="${daysUntil(next.date) < 0 ? "late" : ""}">${daysUntil(next.date) === 0 ? "Today" : daysUntil(next.date) < 0 ? "Late" : daysUntil(next.date) + "d"}</b><small>${esc(next.title.slice(0, 18))}</small>` : `<small>Calendar</small>`;
  return `<div class="lbwrap"><button class="chip calchip" id="calBtn" data-popbtn="cal" aria-expanded="${isOpen}" title="${next ? esc(next.title) + " · " + when(next.date) : "Deadlines and reminders"}${late ? ` · ${late} late` : ""}">${ICON}${label}${late ? `<i class="latedot" aria-label="${late} late"></i>` : ""}</button>
    <div class="lbpop calpop" data-pop="cal" ${isOpen ? "" : "hidden"}>${panel(all)}</div></div>`;
}

function panel(all: AgendaItem[]): string {
  const y = month.getFullYear(), mo = month.getMonth(), first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate(), today = todayKey();
  const byDay = new Map<string, AgendaItem[]>();
  for (const x of all) byDay.set(x.date, [...(byDay.get(x.date) || []), x]);
  const cells = [...Array(first)].map(() => `<span></span>`).concat([...Array(days)].map((_, i) => {
    const key = dateKey(new Date(y, mo, i + 1)), items = byDay.get(key) || [];
    return `<button class="cday ${key === today ? "today" : ""} ${key === picked ? "picked" : ""}" data-day="${key}" aria-pressed="${key === picked}" aria-label="${new Date(y, mo, i + 1).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}">${i + 1}<span class="cdots">${items.slice(0, 3).map(x => `<i style="background:${x.done ? "var(--line)" : x.color}"></i>`).join("")}</span></button>`;
  }));
  const list = picked ? all.filter(x => x.date === picked) : open(all).slice(0, 6);
  const courses = liveCourses();
  return `<div class="calhead"><h3>${month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3><span><button class="calnav" data-cal="-1" aria-label="Previous month">‹</button><button class="calnav" data-cal="0" title="Back to today">Today</button><button class="calnav" data-cal="1" aria-label="Next month">›</button></span></div>
    <div class="calgrid" role="group" aria-label="Days">${["S", "M", "T", "W", "T", "F", "S"].map(d => `<em>${d}</em>`).join("")}${cells.join("")}</div>
    <h3>${picked ? new Date(`${picked}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Coming up"}</h3>
    <div class="callist">${list.length ? list.map(x => `<div class="crowd ${x.done ? "done" : ""} ${!x.done && daysUntil(x.date) < 0 && x.kind === "deadline" ? "late" : ""}">
        ${x.kind === "deadline" ? `<input type="checkbox" data-done="${x.id}" ${x.done ? "checked" : ""} aria-label="Done: ${esc(x.title)}">` : `<i class="ckind" style="background:${x.color}" title="${x.kind === "exam" ? "Exam" : "Reminder from a marker"}"></i>`}
        ${x.kind === "reminder" ? `<button class="ctitle linkbtn" data-open="${x.noteId}" data-marker="${x.markerId}" title="Open the note this reminder is on">${esc(x.title)}</button>` : `<span class="ctitle">${esc(x.title)}</span>`}
        <small>${picked ? (x.kind === "deadline" ? "" : x.kind) : when(x.date)}</small>
        ${x.kind === "deadline" ? `<button class="cdel" data-del="${x.id}" aria-label="Remove ${esc(x.title)}">×</button>` : ""}</div>`).join("")
      : `<div class="note">${picked ? "Nothing on this day." : "Nothing coming up. Add a deadline below, or tell a marker “remind me Friday”."}</div>`}</div>
    <form class="caladd" id="calAdd"><input id="calTitle" maxlength="120" placeholder="Add a deadline…" aria-label="Deadline" autocomplete="off" required>
      <input type="date" id="calDate" value="${picked || today}" aria-label="Due date" required>
      ${courses.length > 1 ? `<select id="calCourse" aria-label="${groupWord(true)}"><option value="">Any ${groupWord()}</option>${courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>` : ""}
      <button class="btn small primary">Add</button></form>`;
}

/** Wires the open panel. `redraw` re-renders the top line; `openNote` jumps to a reminder's note. */
export function wireCalendar(root: HTMLElement, redraw: () => void, openNote: (noteId: string, markerId?: string) => void) {
  const pop = root.querySelector<HTMLElement>(".calpop");
  if (!pop) return;
  pop.addEventListener("click", e => e.stopPropagation()); // clicks inside don't close it
  pop.querySelectorAll<HTMLButtonElement>("[data-cal]").forEach(b => b.onclick = () => {
    const step = +b.dataset.cal!;
    if (step) month = new Date(month.getFullYear(), month.getMonth() + step, 1); else { month = new Date(); month.setDate(1); picked = null; }
    redraw();
  });
  pop.querySelectorAll<HTMLButtonElement>("[data-day]").forEach(b => b.onclick = () => { picked = picked === b.dataset.day ? null : b.dataset.day!; redraw(); });
  pop.querySelectorAll<HTMLInputElement>("[data-done]").forEach(c => c.onchange = async () => { await setDeadlineDone(c.dataset.done!, c.checked); redraw(); });
  pop.querySelectorAll<HTMLButtonElement>("[data-del]").forEach(b => b.onclick = async () => { await removeDeadline(b.dataset.del!); redraw(); });
  pop.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => b.onclick = () => openNote(b.dataset.open!, b.dataset.marker));
  const form = pop.querySelector<HTMLFormElement>("#calAdd")!;
  form.onsubmit = async e => {
    e.preventDefault();
    const title = (form.querySelector("#calTitle") as HTMLInputElement).value, date = (form.querySelector("#calDate") as HTMLInputElement).value;
    if (!title.trim() || !date) return;
    await addDeadline(title, date, (form.querySelector("#calCourse") as HTMLSelectElement | null)?.value || null);
    const d = new Date(`${date}T00:00:00`); month = new Date(d.getFullYear(), d.getMonth(), 1); // show the month it landed in
    redraw();
    (document.querySelector("#calTitle") as HTMLInputElement | null)?.focus();
  };
}
