import type { ClassesBackend, RosterRow, StudentWork, TeacherClass } from "../../marker-slides/app/classesApi";
import { classroomClient } from "./client";

/* A teacher's classes on LiveBoard's own Supabase project: the teacher_* functions in supabase/schema.sql. Every one of
   them checks on the server that the caller owns the class; a student's work is only readable while they share it. */
export function supabaseClasses(): ClassesBackend | null {
  const sb = classroomClient();
  if (!sb) return null;
  const run = async <T>(fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(/sign in/i.test(error.message) || error.code === "PGRST301" ? "Sign in to LiveBoard to use classes." : error.message || "Could not reach your classes.");
    return data as T;
  };
  return {
    async account() { const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email || "" } : null; },
    async list() {
      const rows = await run<{ id: string; name: string; code: string; students: number; live_room: string | null; live_title: string | null }[]>("teacher_classes");
      return rows.map((r): TeacherClass => ({ id: r.id, name: r.name, code: r.code, students: Number(r.students), liveRoom: r.live_room, liveTitle: r.live_title }));
    },
    async create(name, teacher) { const rows = await run<{ id: string; code: string }[]>("teacher_create_class", { p_name: name, p_teacher: teacher }); return rows[0]; },
    async rename(id, name) { await run("teacher_rename_class", { p_class: id, p_name: name }); },
    async remove(id) { await run("teacher_delete_class", { p_class: id }); },
    async roster(id) {
      const rows = await run<Record<string, unknown>[]>("teacher_roster", { p_class: id });
      return rows.map((r): RosterRow => ({ userId: String(r.user_id), name: String(r.display_name), joined: String(r.joined_at), shares: !!r.shares, notes: Number(r.notes), markers: Number(r.markers), mastered: Number(r.mastered), due: Number(r.due), points: Number(r.points), lastActive: r.last_active == null ? null : Number(r.last_active) }));
    },
    async work(classId, studentId) {
      const w = await run<StudentWork>("teacher_student_work", { p_class: classId, p_student: studentId });
      return { notes: Array.isArray(w?.notes) ? w.notes : [], markers: Array.isArray(w?.markers) ? w.markers : [] };
    },
    async tieRoom(room, secret, classId) { await run("room_for_class", { p_room: room, p_secret: secret, p_class: classId }); }
  };
}
