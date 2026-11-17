import { liveCourses, liveMarkers, note, putMeta, state } from "./store";
import { getRole } from "./role";
import type { Deadline, EntryKind } from "./types";
import { DAY, uid } from "./util";

/* Deadlines: dated things you add yourself (an essay due, a bill, a trip). They live with the account's profile, so
   they sync without a table of their own. Each one carries its own updatedAt and is merged one by one, here and on the
   server (push_profile), so two devices adding or ticking different deadlines never erase each other. A deleted one
   stays as a tombstone for a while so the delete reaches other devices too. */

const DATE = /^\d{4}-\d\d-\d\d$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS: EntryKind[] = ["deadline", "exam", "event", "study", "note"];
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
      done: x.done === true, deleted: x.deleted === true, updatedAt: typeof x.updatedAt === "number" && isFinite(x.updatedAt) ? x.updatedAt : 0,
      kind: KINDS.includes(x.kind as EntryKind) ? x.kind as EntryKind : "deadline", time: typeof x.time === "string" && TIME.test(x.time) ? x.time : null,
      repeat: x.repeat === "weekly" ? "weekly" as const : null, noteId: typeof x.noteId === "string" ? x.noteId.slice(0, 64) : null }];
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
/** Adds a deadline (or, with `more`, an exam, event, study session or day note). Resolves with its id (null if the
 *  title or date was unusable), so it can be undone. */
export async function addDeadline(title: string, date: string, courseId: string | null = null, more: { kind?: EntryKind; time?: string | null; repeat?: "weekly" | null; noteId?: string | null } = {}): Promise<string | null> {
  if (!DATE.test(date) || !title.trim()) return null;
  const id = uid();
  await save({ id, title: title.trim().slice(0, 120), date, courseId, done: false, deleted: false, updatedAt: Date.now(),
    kind: more.kind || "deadline", time: more.time && TIME.test(more.time) ? more.time : null, repeat: more.repeat === "weekly" ? "weekly" : null, noteId: more.noteId || null });
  return id;
}
/** Review sessions before an exam or deadline: a week, three days and one day before, skipping any already past. */
export async function planReviews(title: string, date: string, courseId: string | null) {
  const due = new Date(`${date}T00:00:00`), today = todayKey(), made: string[] = [];
  for (const back of [7, 3, 1]) {
    const d = dateKey(new Date(due.getFullYear(), due.getMonth(), due.getDate() - back));
    if (d < today) continue;
    const id = await addDeadline(`Review: ${title}`.slice(0, 120), d, courseId, { kind: "study" });
    if (id) made.push(id);
  }
  return made;
}
const own = (id: string) => id.split("@")[0]; // a weekly showing's id is the entry's id + "@" + its date
export const setDeadlineDone = (id: string, done: boolean) => { const d = liveDeadlines().find(x => x.id === own(id)); return d ? save({ ...d, done, updatedAt: Date.now() }) : Promise.resolve(); };
export const removeDeadline = (id: string) => { const d = liveDeadlines().find(x => x.id === own(id)); return d ? save({ ...d, deleted: true, updatedAt: Date.now() }) : Promise.resolve(); };

/** Everything with a date, in one list: your entries, reminders set from markers, and (for students) course exams.
 *  An entry that repeats weekly shows once a week from its first date, up to `until` (a YYYY-MM-DD, default about
 *  four months on); each showing has the entry's id plus "@" and the date. */
export interface AgendaItem { kind: EntryKind | "reminder"; id: string; title: string; date: string; color: string; done?: boolean; noteId?: string; markerId?: string;
  time?: string | null; courseId?: string | null; repeat?: boolean; own?: boolean }
export function agenda(until?: string): AgendaItem[] {
  const courses = liveCourses(), color = (id?: string | null) => courses.find(c => c.id === id)?.color || "var(--cobalt)";
  const last = until || dateKey(new Date(Date.now() + 120 * DAY));
  const out: AgendaItem[] = [];
  for (const d of liveDeadlines()) {
    const base = { kind: d.kind || "deadline", title: d.title, color: color(d.courseId), done: d.done, time: d.time || null, courseId: d.courseId || null, noteId: d.noteId || undefined, own: true };
    if (d.repeat !== "weekly") { out.push({ ...base, id: d.id, date: d.date }); continue; }
    const start = new Date(`${d.date}T00:00:00`);
    for (let k = 0; k < 60; k++) {
      const day = dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * k));
      if (day > last) break;
      out.push({ ...base, id: `${d.id}@${day}`, date: day, done: false, repeat: true });
    }
  }
  for (const m of liveMarkers()) {
    if (m.type !== "reminder" || !m.remindAt || m.closedAt) continue;
    const n = note(m.noteId); if (!n || n.deleted) continue;
    out.push({ kind: "reminder", id: m.id, title: (m.text || n.title || "Reminder").slice(0, 80), date: dateKey(new Date(m.remindAt)), color: color(n.courseId), noteId: n.id, markerId: m.id, courseId: n.courseId });
  }
  if (getRole() === "student") for (const c of courses) if (c.examDate && DATE.test(c.examDate)) out.push({ kind: "exam", id: "exam:" + c.id, title: `${c.name} exam`, date: c.examDate, color: c.color, courseId: c.id });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99"));
}
