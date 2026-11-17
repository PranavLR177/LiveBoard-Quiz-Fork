// An in-memory stand-in for the class functions in supabase/schema.sql: a teacher's classes (teacher_*), joining with
// consent (class_preview, join_class, leave_class, my_classes), the leaderboard and tying a live lesson to a class.
// Same rules as the SQL, which tests/sql/check.sql checks for real: a teacher sees a student's work only from the one
// course the student linked, and only while they share it; leaving ends it.
const crypto = require("node:crypto");
class FakeClasses {
  /** `rows(uid)` gives a user's synced notes and markers (FakeSupabase's rows), for the roster and a student's work. */
  constructor(rows = () => ({ notes: [], markers: [] }), rooms = null) { this.classes = new Map(); this.members = []; this.rows = rows; this.rooms = rooms; this.calls = []; this.onPing = null; }
  member(uid, classId) { return this.members.some(m => m.class_id === classId && m.user_id === uid); }
  code() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c; do { c = Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join(""); } while ([...this.classes.values()].some(x => x.code === c)); return c; }
  owned(id, uid) { const c = this.classes.get(id); if (!c || c.owner !== uid || c.kind !== "teacher") throw new Error("Class not found."); return c; }
  byCode(code) { return [...this.classes.values()].find(c => c.code === String(code || "").trim().toUpperCase()); }
  count(id) { return this.members.filter(m => m.class_id === id).length; }
  live(id) { if (!this.rooms) return null; const r = [...this.rooms.rooms.values()].find(r => r.classId === id); return r ? { id: r.id, title: r.title } : null; }
  work(m) {
    const { notes, markers } = this.rows(m.user_id);
    const ns = notes.filter(n => !n.deleted && n.data.courseId === m.course_id);
    const ids = new Set(ns.map(n => n.id));
    return { ns, ks: markers.filter(k => !k.deleted && ids.has(k.data.noteId)) };
  }
  /** Returns the RPC's answer, throws its error, or returns undefined when `name` isn't one of these. */
  rpc(name, b, uid) {
    if (!uid) throw new Error("sign in required");
    switch (name) {
      case "teacher_create_class": {
        const name_ = String(b.p_name || "").trim().slice(0, 60);
        if (!name_) throw new Error("Give the class a name.");
        const id = crypto.randomUUID(), code = this.code();
        this.classes.set(id, { id, name: name_, code, kind: "teacher", owner: uid, teacher: String(b.p_teacher || "").trim().slice(0, 40) || null, created: Date.now() });
        return [{ id, code }];
      }
      case "teacher_classes":
        return [...this.classes.values()].filter(c => c.owner === uid && c.kind === "teacher").sort((a, b) => a.name.localeCompare(b.name))
          .map(c => { const l = this.live(c.id); return { id: c.id, name: c.name, code: c.code, students: this.count(c.id), live_room: l?.id || null, live_title: l?.title || null, created_at: new Date(c.created).toISOString() }; });
      case "teacher_rename_class": this.owned(b.p_class, uid).name = String(b.p_name || "").trim().slice(0, 60); return null;
      case "teacher_delete_class": this.owned(b.p_class, uid); this.classes.delete(b.p_class); this.members = this.members.filter(m => m.class_id !== b.p_class); return null;
      case "teacher_roster": {
        this.owned(b.p_class, uid);
        return this.members.filter(m => m.class_id === b.p_class).map(m => {
          const { ns, ks } = m.shares ? this.work(m) : { ns: [], ks: [] };
          const last = Math.max(0, ...ns.map(n => n.updated_at), ...ks.map(k => k.updated_at));
          return { user_id: m.user_id, display_name: m.display, joined_at: new Date(m.joined).toISOString(), shares: m.shares, notes: ns.length, markers: ks.length,
            mastered: ks.filter(k => k.data.mastery === 2).length, due: ks.filter(k => (k.data.due || 0) <= Date.now()).length, points: 0, last_active: last || null };
        });
      }
      case "teacher_student_work": {
        this.owned(b.p_class, uid);
        const m = this.members.find(x => x.class_id === b.p_class && x.user_id === b.p_student && x.shares);
        if (!m) throw new Error("This student is not sharing notes with this class.");
        const { ns, ks } = this.work(m);
        return { notes: ns.map(n => ({ id: n.id, title: n.data.title || "", kind: n.data.kind, updated: n.updated_at, text: String(n.data.plain || "").slice(0, 20000) })),
          markers: ks.map(k => ({ id: k.id, noteId: k.data.noteId, type: k.data.type, text: String(k.data.text || ""), mastery: k.data.mastery ?? null, due: k.data.due ?? null, understanding: k.data.understanding || null })) };
      }
      case "class_preview": { const c = this.byCode(b.p_code); return c ? [{ name: c.name, kind: c.kind, teacher_name: c.teacher, students: this.count(c.id) }] : []; }
      case "join_class": {
        const c = this.byCode(b.p_code);
        if (!c) throw new Error("class not found");
        if (c.kind === "teacher" && c.owner === uid) throw new Error("This is your own class.");
        if (c.kind === "teacher" && !b.p_share) throw new Error("Joining a teacher's class shares the course you link with them.");
        const was = this.members.find(m => m.class_id === c.id && m.user_id === uid);
        const m = { class_id: c.id, user_id: uid, display: String(b.p_display || "Student").slice(0, 40), course_id: b.p_course || null, shares: !!b.p_share, joined: Date.now() };
        if (was) Object.assign(was, m, { joined: was.joined }); else this.members.push(m);
        return [{ id: c.id, name: c.name, code: c.code, kind: c.kind }];
      }
      case "leave_class": this.members = this.members.filter(m => !(m.class_id === b.p_class && m.user_id === uid)); return null;
      case "my_classes":
        return this.members.filter(m => m.user_id === uid).map(m => { const c = this.classes.get(m.class_id), l = this.live(c.id);
          return { id: c.id, name: c.name, code: c.code, kind: c.kind, teacher_name: c.teacher, students: this.count(c.id), course_id: m.course_id, shares: m.shares, live_room: l?.id || null, live_title: l?.title || null }; });
      case "class_leaderboard":
        if (!this.members.some(m => m.class_id === b.p_class && m.user_id === uid)) return [];
        return this.members.filter(m => m.class_id === b.p_class).map(m => ({ display_name: m.display, points: 0, is_me: m.user_id === uid }));
      case "room_for_class": {
        if (b.p_class) this.owned(b.p_class, uid);
        const r = this.rooms?.rooms.get(String(b.p_room || "").trim().toUpperCase());
        if (!r || r.secret !== b.p_secret) throw new Error("Only the host can do this.");
        const was = r.classId; r.classId = b.p_class || null;
        // the ping Realtime pushes (class_pings in supabase/schema.sql)
        if (was && was !== r.classId) this.onPing?.("DELETE", { class_id: was });
        if (r.classId) this.onPing?.("INSERT", { class_id: r.classId, room: r.id, title: r.title });
        return null;
      }
      default: return undefined;
    }
  }
}
module.exports = { FakeClasses };
