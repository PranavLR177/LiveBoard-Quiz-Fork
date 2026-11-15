// An in-memory stand-in for the live-class functions in supabase/schema.sql (room_create, room_get, room_screenshot,
// room_act), wired into Playwright with context.route. Same rules as the SQL (tests/sql/check.sql checks the real ones):
// students see their own markers and the teacher's, the projector sees only the teacher's, host actions need the secret.
const crypto = require("node:crypto");
class FakeRooms {
  constructor() { this.rooms = new Map(); this.calls = []; }
  seeAll(m, teacher, projector, participant) { return (teacher && !projector) || m.author === "Teacher" || (!projector && !!participant && m.owner === participant); }
  author(name, teacher) { if (teacher) return "Teacher"; const n = String(name || "").trim(); return n.toLowerCase() === "teacher" ? "Student" : (n.slice(0, 40) || "Student"); }
  create({ p_title, p_slides, p_student_markers }) {
    const fields = ["title", "kicker", "body", "detail", "visual", "notes"];
    if (!Array.isArray(p_slides) || !p_slides.length || p_slides.length > 40 || !p_slides.every(s => s && fields.every(k => typeof s[k] === "string"))) throw new Error("Use 1–40 slides, under 5 MB.");
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(), secret = crypto.randomUUID();
    this.rooms.set(id, { id, secret, title: String(p_title || "").trim().slice(0, 100) || "Untitled lesson", slides: p_slides, current: 0, until: 0, studentMarkers: p_student_markers === false ? 0 : 1, markers: [], replies: [] });
    return { id, secret };
  }
  room(id) { const r = this.rooms.get(String(id || "").trim().toUpperCase()); if (!r) throw new Error("Room not found. Check the code with your teacher."); return r; }
  get({ p_id, p_secret, p_participant, p_projector }) {
    const r = this.room(p_id), teacher = !!p_secret && p_secret === r.secret, proj = !!p_projector;
    const marks = r.markers.filter(m => this.seeAll(m, teacher, proj, p_participant));
    const ids = new Set(marks.map(m => m.id));
    return { id: r.id, title: r.title, current: r.current, until: r.until, studentMarkers: r.studentMarkers,
      slides: teacher && !proj ? r.slides : r.slides.map(s => ({ ...s, notes: "" })),
      markers: marks.map(({ owner, screenshot, ...m }) => ({ ...m, has_screenshot: !!screenshot })),
      replies: proj ? [] : r.replies.filter(x => ids.has(x.marker)).map(({ id, marker, author, body }) => ({ id, marker, author, body })) };
  }
  shot({ p_room, p_marker, p_secret, p_participant }) {
    const r = this.room(p_room), m = r.markers.find(x => x.id === p_marker);
    return m && this.seeAll(m, !!p_secret && p_secret === r.secret, false, p_participant) ? m.screenshot || null : null;
  }
  act({ p_room, p_action, p_data: d, p_secret, p_participant }) {
    const r = this.room(p_room), teacher = !!p_secret && p_secret === r.secret, part = String(p_participant || "").slice(0, 100) || null;
    const body = String(d.body || "").trim().slice(0, 2000);
    if (["control", "resolve", "end"].includes(p_action) && !teacher) throw new Error("Only the host can do this.");
    if (p_action === "control") {
      if (Number.isInteger(d.current)) r.current = Math.max(0, Math.min(r.slides.length - 1, d.current));
      if (typeof d.duration === "number") r.until = d.duration > 0 ? Date.now() + Math.min(900, d.duration) * 1000 : 0;
      if (typeof d.studentMarkers === "boolean") r.studentMarkers = d.studentMarkers ? 1 : 0;
    } else if (p_action === "marker") {
      if (!teacher && !r.studentMarkers) throw new Error("Your teacher has paused student markers.");
      if (!["question", "explain", "idea"].includes(d.kind) || !body) throw new Error("Write your request first.");
      if (!Number.isInteger(d.slide) || d.slide < 0 || d.slide >= r.slides.length || typeof d.x !== "number" || typeof d.y !== "number") throw new Error("Select a spot on the slide.");
      if (d.screenshot && !d.region) throw new Error("Invalid slide screenshot.");
      const id = crypto.randomUUID();
      r.markers.push({ id, slide: d.slide, x: Math.max(2, Math.min(98, d.x)), y: Math.max(2, Math.min(98, d.y)), kind: d.kind, author: this.author(d.author, teacher), body, resolved: 0, created: Date.now(), region: d.region || null, screenshot: d.screenshot || null, owner: part });
      return { id };
    } else if (p_action === "resolve") {
      const m = r.markers.find(x => x.id === d.id); if (m) m.resolved = d.resolved ? 1 : 0;
    } else if (p_action === "reply") {
      const m = r.markers.find(x => x.id === d.id);
      if (!m || !this.seeAll(m, teacher, false, part)) throw new Error("Marker not found");
      if (!body) throw new Error("Write a response first.");
      r.replies.push({ id: crypto.randomUUID(), marker: m.id, author: this.author(d.author, teacher), body });
    } else if (p_action === "end") this.rooms.delete(r.id);
    else throw new Error("Unknown action");
    return { ok: true };
  }
  async attach(ctx) {
    await ctx.route("http://sb.test/**", async route => {
      const req = route.request(), name = new URL(req.url()).pathname.replace("/rest/v1/rpc/", "");
      const handlers = { room_create: "create", room_get: "get", room_screenshot: "shot", room_act: "act" };
      if (!handlers[name]) return route.fulfill({ status: 404, json: { message: "not faked: " + name } });
      this.calls.push(name);
      try { return route.fulfill({ json: this[handlers[name]](JSON.parse(req.postData() || "{}")) }); }
      catch (e) { return route.fulfill({ status: 400, json: { code: "P0001", message: e.message } }); }
    });
  }
}
module.exports = { FakeRooms };
