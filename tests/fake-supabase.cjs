// An in-memory stand-in for the parts of Supabase LiveBoard uses, wired into Playwright with page.route.
// push_rows follows the same rules as supabase/schema.sql (revision check, owner check, server sequence).
class FakeSupabase {
  constructor() { this.rows = { notes: new Map(), markers: new Map(), courses: new Map() }; this.profiles = new Map(); this.gen = new Map(); this.seq = 0; this.down = false; this.calls = []; this.beforePush = null; this.refuse = new Set(); this.more = null; this.sockets = new Set(); this.pcId = 0; this.canSee = () => true; }
  genOf(uid) { return this.gen.get(uid) || 0; }
  static session(uid) {
    const now = Math.floor(Date.now() / 1000);
    return { access_token: `tok-${uid}`, refresh_token: `ref-${uid}`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: uid, aud: "authenticated", role: "authenticated", email: `${uid.slice(-4)}@test.edu` } };
  }
  /** Sends a database change to Realtime listeners, as the server would after a write. */
  push(table, type, record, old = {}) {
    for (const { ws, joins } of this.sockets) for (const j of joins) {
      const ids = j.pc.filter(f => (f.table === table || f.table === "*") && (f.event === "*" || f.event === type)).map(f => f.id);
      if (!ids.length || !j.uid || (type !== "DELETE" && !this.canSee(j.uid, table, record))) continue;
      ws.send(JSON.stringify([j.jr, null, j.topic, "postgres_changes", { ids, data: { schema: "public", table, type, commit_timestamp: new Date().toISOString(), columns: [], errors: null, record: type === "DELETE" ? null : record, old_record: old } }]));
    }
  }
  listening(table) { return [...this.sockets].some(s => s.joins.some(j => j.pc.some(f => f.table === table))); }
  userOf(req) { const m = /Bearer tok-([\w-]+)/.exec(req.headers()["authorization"] || ""); return m ? m[1] : null; }
  all(kind, uid) { return [...this.rows[kind].values()].filter(r => r.user_id === uid); }
  pushRows(uid, kind, rows) {
    return rows.map(r => {
      const cur = this.rows[kind].get(r.id);
      if ((cur && cur.user_id !== uid) || this.refuse.has(r.id) || JSON.stringify(r.data).length > 2000000) return { id: r.id, status: "invalid" };
      if (!cur) { this.rows[kind].set(r.id, { id: r.id, user_id: uid, data: r.data, updated_at: r.updated_at, deleted: !!r.deleted, rev: 1, seq: ++this.seq }); return { id: r.id, status: "ok", rev: 1 }; }
      const base = typeof r.base_rev === "number" ? r.base_rev : null;
      if ((base !== null && cur.rev === base) || (base === null && r.updated_at > cur.updated_at)) {
        Object.assign(cur, { data: r.data, updated_at: r.updated_at, deleted: !!r.deleted, rev: cur.rev + 1, seq: ++this.seq });
        return { id: r.id, status: "ok", rev: cur.rev };
      }
      return { id: r.id, status: base === null ? "stale" : "conflict", rev: cur.rev, data: cur.data, deleted: cur.deleted };
    });
  }
  async attach(page) {
    // Realtime: enough of the Phoenix protocol (vsn 2.0.0, array frames) for postgres_changes. `push` sends a change
    // to every channel listening to that table whose user `canSee(uid, table, row)`, as Realtime does with RLS.
    await page.routeWebSocket(/sb\.test\/realtime\/v1\/websocket/, ws => {
      const sock = { ws, joins: [] };
      this.sockets.add(sock);
      ws.onClose(() => this.sockets.delete(sock));
      ws.onMessage(raw => {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        const [jr, ref, topic, event, payload] = Array.isArray(m) ? m : [m.join_ref, m.ref, m.topic, m.event, m.payload];
        const reply = response => ws.send(JSON.stringify([jr, ref, topic, "phx_reply", { status: "ok", response }]));
        const tok = t => { const x = /^tok-([\w-]+)$/.exec(t || ""); return x ? x[1] : null; };
        if (event === "phx_join") {
          const pc = (payload?.config?.postgres_changes || []).map(f => ({ ...f, id: ++this.pcId }));
          sock.joins = sock.joins.filter(j => j.topic !== topic);
          sock.joins.push({ topic, jr, pc, uid: tok(payload?.access_token) });
          return reply({ postgres_changes: pc });
        }
        if (event === "access_token") { const j = sock.joins.find(j => j.topic === topic); if (j) j.uid = tok(payload?.access_token); return; }
        if (event === "phx_leave") { sock.joins = sock.joins.filter(j => j.topic !== topic); return reply({}); }
        reply({});
      });
    });
    await page.route("http://sb.test/**", async route => {
      const req = route.request(), url = new URL(req.url()), uid = this.userOf(req);
      this.calls.push(`${req.method()} ${url.pathname}`);
      if (this.down) return route.abort("internetdisconnected");
      if (url.pathname === "/auth/v1/verify") {
        const body = JSON.parse(req.postData() || "{}");
        if (body.token !== "123456") return route.fulfill({ status: 403, json: { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" } });
        return route.fulfill({ json: FakeSupabase.session(this.codeUser) });
      }
      if (url.pathname.startsWith("/auth/v1/")) return route.fulfill({ json: {} });
      if (!uid) return route.fulfill({ status: 401, json: { message: "JWT required" } });
      const json = (b, status = 200) => route.fulfill({ status, json: b, headers: { "content-type": "application/json" } });
      if (url.pathname === "/rest/v1/rpc/delete_my_data") {
        for (const k of Object.keys(this.rows)) for (const [id, r] of this.rows[k]) if (r.user_id === uid) this.rows[k].delete(id);
        this.profiles.delete(uid);
        this.gen.set(uid, this.genOf(uid) + 1);
        return json(this.genOf(uid));
      }
      if (url.pathname === "/rest/v1/rpc/sync_state") return json({ gen: this.genOf(uid) });
      if (url.pathname === "/rest/v1/rpc/push_profile") {
        const { p_data, p_gen } = JSON.parse(req.postData() || "{}");
        if (p_gen !== this.genOf(uid)) return json({ status: "erased" });
        // like the real push_profile: deadlines merge per item, the copy changed last wins
        const by = new Map();
        for (const d of [...((this.profiles.get(uid) || {}).deadlines || []), ...(Array.isArray(p_data.deadlines) ? p_data.deadlines : [])]) { const have = by.get(d.id); if (!have || (d.updatedAt || 0) > (have.updatedAt || 0)) by.set(d.id, d); }
        this.profiles.set(uid, { ...p_data, deadlines: [...by.values()].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)) });
        return json({ status: "ok" });
      }
      if (url.pathname === "/rest/v1/rpc/push_rows") {
        const { p_kind, p_rows, p_gen } = JSON.parse(req.postData() || "{}");
        if (this.beforePush) { const hook = this.beforePush; this.beforePush = null; await hook(p_kind, p_rows); }
        if (p_gen !== this.genOf(uid)) return json(p_rows.map(r => ({ id: r.id, status: "erased" })));
        return json(this.pushRows(uid, p_kind, p_rows));
      }
      const kind = url.pathname.replace("/rest/v1/", "");
      if (kind === "profiles") {
        if (req.method() === "GET") return json(this.profiles.has(uid) ? [{ data: this.profiles.get(uid) }] : []);
        const body = JSON.parse(req.postData() || "{}");
        void body; return route.fulfill({ status: 403, json: { message: "profiles are written through push_profile" } }); // mirrors the read-only policy
        return route.fulfill({ status: 201, body: "" });
      }
      if (this.rows[kind] && req.method() === "GET") {
        const gt = Number((url.searchParams.get("seq") || "gt.0").replace("gt.", ""));
        const out = this.all(kind, uid).filter(r => r.seq > gt).sort((a, b) => a.seq - b.seq).slice(0, 500).map(r => ({ id: r.id, data: r.data, rev: r.rev, seq: r.seq, deleted: r.deleted }));
        return json(out);
      }
      if (this.more && url.pathname.startsWith("/rest/v1/rpc/")) {
        // other server functions (classes, live rooms) from another fake: tests/fake-classes.cjs
        try { const r = await this.more(url.pathname.replace("/rest/v1/rpc/", ""), JSON.parse(req.postData() || "{}"), uid); if (r !== undefined) return json(r); }
        catch (e) { return json({ code: "P0001", message: e.message }, 400); }
      }
      return json({ message: "not faked: " + url.pathname }, 404);
    });
  }
}
module.exports = { FakeSupabase };
