// An in-memory stand-in for the class functions in supabase/schema.sql: a teacher's classes (teacher_*), joining with
// consent (class_preview, join_class, leave_class, my_classes), the leaderboard and tying a live lesson to a class.
// Same rules as the SQL, which tests/sql/check.sql checks for real: a teacher sees a student's work only from the one
// course the student linked, and only while they share it; leaving ends it.
const crypto = require("node:crypto");
class FakeClasses {
  /** `rows(uid)` gives a user's synced notes and markers (FakeSupabase's rows), for the roster and a student's work. */
  constructor(rows = () => ({ notes: [], markers: [] }), rooms = null) { this.classes = new Map(); this.members = []; this.rows = rows; this.rooms = rooms; this.calls = []; this.onPing = null; this.quizzes = []; this.results = []; }
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
      // pop quizzes (class_quizzes / quiz_results in supabase/schema.sql)
      case "teacher_release_quiz": {
        const c = this.owned(b.p_class, uid);
        const qs = (Array.isArray(b.p_questions) ? b.p_questions : []).filter(x => x && (String(x.q || "").trim() || x.img)).map((x, n) => {
          if (x.img && !(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(x.img) && x.img.length <= 280000)) throw new Error(`Question ${n + 1}: that picture is too large or not an image.`);
          const type = x.type === "choice" || x.type === "tf" ? x.type : "short", out = { type, q: String(x.q || "").trim().slice(0, 300), a: String(x.a || "").trim().slice(0, 600) };
          if (type === "tf") { if (![0, 1].includes(x.correct)) throw new Error(`Question ${n + 1}: pick whether it's true or false.`); Object.assign(out, { options: ["True", "False"], correct: x.correct }); }
          if (type === "choice") { const o = (x.options || []).map(v => String(v).trim().slice(0, 120)).filter(Boolean); if (o.length < 2 || o.length > 6) throw new Error(`Question ${n + 1}: give 2 to 6 options.`); if (!(x.correct >= 0 && x.correct < o.length)) throw new Error(`Question ${n + 1}: mark the right option.`); Object.assign(out, { options: o, correct: x.correct }); }
          if (x.img) out.img = x.img;
          return out;
        });
        if (!qs.length) throw new Error("Add at least one question.");
        if (qs.length > 20) throw new Error("A pop quiz holds up to 20 questions.");
        const q = { id: crypto.randomUUID(), class_id: c.id, title: String(b.p_title || "").trim().slice(0, 80) || "Pop quiz", questions: qs, required: !!b.p_required, due_at: b.p_due || null, closed: false, shuffle: !!b.p_shuffle, created_at: new Date().toISOString() };
        this.quizzes.unshift(q);
        this.onPing?.("INSERT", { id: q.id, class_id: q.class_id, title: q.title }, "class_quizzes");
        return q.id;
      }
      case "teacher_quizzes": {
        this.owned(b.p_class, uid);
        return this.quizzes.filter(q => q.class_id === b.p_class).map(q => { const rs = this.results.filter(r => r.quiz_id === q.id && this.member(r.user_id, q.class_id));
          return { id: q.id, title: q.title, questions: q.questions.length, required: q.required, due_at: q.due_at, closed: q.closed, created_at: q.created_at, done: rs.length, students: this.count(q.class_id), avg_pct: rs.length ? Math.round(100 * rs.reduce((t, r) => t + r.score / r.total, 0) / rs.length) : null, shuffle: !!q.shuffle, items: q.questions.map(({ img, ...x }) => x) }; });
      }
      case "teacher_quiz_results": {
        const q = this.quizzes.find(x => x.id === b.p_quiz); if (!q) throw new Error("Quiz not found."); this.owned(q.class_id, uid);
        return this.members.filter(m => m.class_id === q.class_id).map(m => { const r = this.results.find(x => x.quiz_id === q.id && x.user_id === m.user_id);
          return { user_id: m.user_id, display_name: m.display, done: !!r, score: r?.score ?? null, total: r?.total ?? null, finished_at: r?.at ?? null, answers: r?.answers ?? null }; });
      }
      case "teacher_close_quiz": {
        const q = this.quizzes.find(x => x.id === b.p_quiz); if (!q) throw new Error("Quiz not found."); this.owned(q.class_id, uid);
        if (b.p_delete) this.quizzes = this.quizzes.filter(x => x !== q); else q.closed = true; return null;
      }
      case "my_quizzes":
        return this.quizzes.filter(q => this.member(uid, q.class_id)).map(q => { const r = this.results.find(x => x.quiz_id === q.id && x.user_id === uid), c = this.classes.get(q.class_id);
          return (!q.closed || r) ? { id: q.id, class_id: q.class_id, class_name: c.name, teacher_name: c.teacher, title: q.title, questions: q.questions, required: q.required, due_at: q.due_at, created_at: q.created_at, done: !!r, score: r?.score ?? null, total: r?.total ?? null, shuffle: !!q.shuffle } : null; }).filter(Boolean);
      case "submit_quiz": {
        const q = this.quizzes.find(x => x.id === b.p_quiz && this.member(uid, x.class_id));
        if (!q) throw new Error("Quiz not found.");
        if (q.closed) throw new Error("This quiz is closed.");
        if (!Array.isArray(b.p_answers) || b.p_answers.length !== q.questions.length) throw new Error("Answer every question.");
        let r = this.results.find(x => x.quiz_id === q.id && x.user_id === uid);
        if (!r) { const answers = b.p_answers.map((a, i) => { const it = q.questions[i], objective = it.type !== "short", pick = objective && typeof a.pick === "number" ? a.pick : undefined; return { got: objective ? pick === it.correct : !!a.got, said: String(a.said || "").slice(0, 400), ...(pick !== undefined ? { pick } : {}) }; }); r = { quiz_id: q.id, user_id: uid, answers, score: answers.filter(a => a.got).length, total: answers.length, at: new Date().toISOString() }; this.results.push(r); }
        return { score: r.score, total: r.total };
      }
      default: return undefined;
    }
  }
}
module.exports = { FakeClasses };
