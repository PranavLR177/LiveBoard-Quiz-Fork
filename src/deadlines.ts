import { liveCourses, liveMarkers, note, putMeta, state } from "./store";
import { getRole } from "./role";
import type { Deadline } from "./types";
import { DAY, uid } from "./util";

/* Deadlines: dated things you add yourself (an essay due, a bill, a trip). They live with the account's profile, so
   they sync without a table of their own. Each one carries its own updatedAt and is merged one by one, here and on the
   server (push_profile), so two devices adding or ticking different deadlines never erase each other. A deleted one
   stays as a tombstone for a while so the delete reaches other devices too. */

const DATE = /^\d{4}-\d\d-\d\d$/;
export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayKey = () => dateKey(new Date());
/** Whole days from today to a YYYY-MM-DD date (negative when it has passed). */
export const daysUntil = (date: string) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(`${date}T00:00:00`).getTime() - t.getTime()) / DAY); };

export function cleanDeadlines(list: unknown): Deadline[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap(d => {
    if (!d || typeof d !== "object") return [];
    const x = d as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id || x.id.length > 64 || typeof x.date !== "string" || !DATE.test(x.date)) return [];
    return [{ id: x.id, title: String(x.title ?? "").slice(0, 120), date: x.date, courseId: typeof x.courseId === "string" ? x.courseId.slice(0, 64) : null,
      done: x.done === true, deleted: x.deleted === true, updatedAt: typeof x.updatedAt === "number" && isFinite(x.updatedAt) ? x.updatedAt : 0 }];
  });
}

/** Two copies of the list become one: for each deadline, whichever copy was changed last. */
export function mergeDeadlines(a: Deadline[], b: Deadline[]): Deadline[] {
  const by = new Map<string, Deadline>();
  for (const d of [...a, ...b]) { const have = by.get(d.id); if (!have || d.updatedAt > have.updatedAt) by.set(d.id, d); }
  const cutoff = Date.now() - 45 * DAY;
  return [...by.values()].filter(d => !(d.deleted && d.updatedAt < cutoff)).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)).slice(0, 400);
}
export const sameDeadlines = (a: Deadline[], b: Deadline[]) => a.length === b.length && a.every((d, i) => d.id === b[i].id && d.updatedAt === b[i].updatedAt);

export const liveDeadlines = () => (state.meta.deadlines || []).filter(d => !d.deleted);

async function save(d: Deadline) {
  const rest = (state.meta.deadlines || []).filter(x => x.id !== d.id);
  await putMeta({ deadlines: mergeDeadlines(rest, [d]) }); // putMeta writes the change and its upload entry in one transaction
}
export const addDeadline = (title: string, date: string, courseId: string | null = null) =>
  DATE.test(date) && title.trim() ? save({ id: uid(), title: title.trim().slice(0, 120), date, courseId, done: false, deleted: false, updatedAt: Date.now() }) : Promise.resolve();
export const setDeadlineDone = (id: string, done: boolean) => { const d = liveDeadlines().find(x => x.id === id); return d ? save({ ...d, done, updatedAt: Date.now() }) : Promise.resolve(); };
export const removeDeadline = (id: string) => { const d = liveDeadlines().find(x => x.id === id); return d ? save({ ...d, deleted: true, updatedAt: Date.now() }) : Promise.resolve(); };

/** Everything with a date, in one list: your deadlines, reminders set from markers, and (for students) exams. */
export interface AgendaItem { kind: "deadline" | "reminder" | "exam"; id: string; title: string; date: string; color: string; done?: boolean; noteId?: string; markerId?: string }
export function agenda(): AgendaItem[] {
  const courses = liveCourses(), color = (id?: string | null) => courses.find(c => c.id === id)?.color || "var(--cobalt)";
  const out: AgendaItem[] = liveDeadlines().map(d => ({ kind: "deadline" as const, id: d.id, title: d.title, date: d.date, color: color(d.courseId), done: d.done }));
  for (const m of liveMarkers()) {
    if (m.type !== "reminder" || !m.remindAt || m.closedAt) continue;
    const n = note(m.noteId); if (!n || n.deleted) continue;
    out.push({ kind: "reminder", id: m.id, title: (m.text || n.title || "Reminder").slice(0, 80), date: dateKey(new Date(m.remindAt)), color: color(n.courseId), noteId: n.id, markerId: m.id });
  }
  if (getRole() === "student") for (const c of courses) if (c.examDate && DATE.test(c.examDate)) out.push({ kind: "exam", id: "exam:" + c.id, title: `${c.name} exam`, date: c.examDate, color: c.color });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
