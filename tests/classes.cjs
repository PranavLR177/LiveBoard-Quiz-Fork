/* Classes end to end, in a real browser against the sync-test build (Supabase at http://sb.test), with the server's
   class functions faked in tests/fake-classes.cjs (tests/sql/check.sql checks the real ones):
     a teacher makes a class; a student joins it by code, agreeing to share one course; the teacher sees that student's
     notes and markers; the teacher tells the class a live lesson started and the student gets a notice and a way in;
     the student leaves and the teacher loses sight of their work. Part of `npm test`. */
const { chromium } = require("playwright");
const { FakeSupabase } = require("./fake-supabase.cjs");
const { FakeRooms } = require("./fake-rooms.cjs");
const { FakeClasses } = require("./fake-classes.cjs");
const BASE = process.env.SYNC_URL || "http://localhost:4174";
const KEY = "sb-sb-auth-token";
const TEACHER = "aaaaaaaa-0000-4000-8000-00000000000a", STUDENT = "bbbbbbbb-0000-4000-8000-00000000000b";
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };

(async () => {
  const b = await chromium.launch();
  const fake = new FakeSupabase(), rooms = new FakeRooms();
  const classes = new FakeClasses(uid => ({ notes: fake.all("notes", uid), markers: fake.all("markers", uid) }), rooms);
  const roomFns = { room_create: "create", room_get: "get", room_screenshot: "shot", room_act: "act" };
  fake.more = (name, body, uid) => roomFns[name] ? rooms[roomFns[name]](body) : classes.rpc(name, body, uid);

  const open = async (role, uid, width = 1300) => {
    const ctx = await b.newContext({ viewport: { width, height: 860 }, serviceWorkers: "block", colorScheme: "light" });
    await ctx.addInitScript(([role, key, session]) => { try { if (!localStorage.getItem("liveboard-role")) localStorage.setItem("liveboard-role", role); if (session && !localStorage.getItem(key)) localStorage.setItem(key, session); } catch {} }, [role, KEY, uid ? JSON.stringify(FakeSupabase.session(uid)) : ""]);
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(role + " pageerror: " + e.message));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
    await fake.attach(p);
    return p;
  };

  // ---- a teacher makes a class
  const t = await open("teacher", TEACHER);
  await t.goto(BASE + "/classroom.html?view=library"); await t.waitForSelector(".reel-card");
  ok(await t.isVisible('.lb-top a:has-text("Classes")'), "a teacher has Classes in the top bar");
  await t.click('.lb-top a:has-text("Classes")'); await t.waitForSelector(".class-empty");
  ok(/No classes yet/.test(await t.textContent(".class-empty")), "with no classes yet, the screen says how classes work");
  await t.click("text=Make your first class");
  await t.fill('.modal input >> nth=0', "AP Biology");
  await t.fill('.modal input >> nth=1', "Ms Rivera");
  await t.click(".modal button.primary"); await t.waitForSelector(".class-code b");
  const code = (await t.textContent(".class-code b")).trim();
  ok(/^[A-Z2-9]{6}$/.test(code) && (await t.textContent(".class-detail h2")) === "AP Biology", `the class gets a six-character join code (${code})`);
  ok(/No students yet/.test(await t.textContent(".class-detail")), "and starts with no students");

  // ---- a student signed out sees how to get in; a live-lesson code works without an account
  const anon = await open("student", null);
  await anon.goto(BASE + "/#classes"); await anon.waitForSelector(".binder");
  ok(await anon.isVisible("#bSignIn") && await anon.isVisible("#bCode"), "signed out, Classes asks to sign in for classes but still takes a code");
  await anon.fill("#bCode", "ab12cd34");
  ok((await anon.inputValue("#bCode")) === "AB12CD34" && /live lesson/.test(await anon.textContent("#bHint")), "eight characters read as a live lesson code");
  await anon.click("#bGo"); await anon.waitForURL(/classroom\.html/);
  const u = new URL(anon.url());
  ok(u.searchParams.get("room") === "AB12CD34" && u.searchParams.get("view") === "student", "and Go goes straight to that lesson's join screen");
  await anon.context().close();

  // ---- a student joins it, agreeing to share one course
  const s = await open("student", STUDENT);
  await s.goto(BASE + "/"); await s.waitForSelector("#dial");
  ok(await s.isVisible('#discussionJoin:has-text("Classes")'), "a student's header has Classes");
  await s.click("#discussionJoin"); await s.waitForSelector(".binder");
  ok(new URL(s.url()).hash === "#classes" && await s.isVisible('.btab.bjoin[aria-selected="true"]'), "Classes opens on the join page when you're in no class");
  await s.fill("#bCode", code.toLowerCase());
  ok(/class code/.test(await s.textContent("#bHint")), "six characters read as a class code");
  await s.click("#bGo"); await s.waitForSelector("#bConfirm");
  const card = await s.textContent(".bpage");
  ok(card.includes("AP Biology") && card.includes("Ms Rivera") && await s.isVisible("#bShare"), "before joining, it shows the class and the teacher, and asks to share");
  if (await s.$("#bName")) await s.fill("#bName", "Priya");
  await s.click("#bConfirm button.primary"); await s.waitForTimeout(300);
  ok(classes.members.length === 0 && await s.isVisible("#bConfirm"), "it won't join a teacher's class without the student agreeing to share");
  await s.check("#bShare");
  await s.click("#bConfirm button.primary");
  await s.waitForSelector(`.btab[aria-selected="true"]:has-text("AP Biology")`);
  const m = classes.members[0];
  ok(m && m.user_id === STUDENT && m.shares === true && !!m.course_id, "joining links one course and shares it");
  ok((await s.textContent(".bhead h2")) === "AP Biology" && /Ms Rivera/.test(await s.textContent(".bhead .eyebrow")), "the binder turns to the class's own page");
  ok(/can read your notes and markers in/.test(await s.textContent(".bfoot")), "which says plainly what the teacher can see");

  // the student takes a note in the class, which syncs
  await s.click("#bNew"); await s.waitForSelector("#editor .ProseMirror");
  await s.fill("#ptitle", "Krebs cycle");
  await s.click("#editor .ProseMirror"); await s.keyboard.type("Acetyl-CoA joins oxaloacetate to make citrate.");
  for (let i = 0; i < 40 && !fake.all("notes", STUDENT).some(n => n.data.title === "Krebs cycle" && /citrate/.test(n.data.plain || "")); i++) await s.waitForTimeout(250);
  ok(fake.all("notes", STUDENT).some(n => n.data.title === "Krebs cycle" && n.data.courseId === m.course_id), "a new note from the class page goes into the linked course and syncs");
  await s.goto(BASE + "/#classes"); await s.waitForSelector(".bnotes li");
  ok((await s.textContent(".bnotes")).includes("Krebs cycle"), "and shows on the class page under Your notes");

  // ---- the teacher sees the student and their work
  await t.reload(); await t.waitForSelector(".roster tbody tr");
  const cells = await t.$$eval(".roster tbody tr >> nth=0 >> td", tds => tds.map(td => td.textContent.trim()));
  ok(cells[0].includes("Priya") && cells[1] === "1", "the roster lists the student with their note count (" + cells.slice(0, 2).join(" | ") + ")");
  await t.click(".roster tbody tr"); await t.waitForSelector(".work-notes li");
  ok((await t.textContent(".student-work")).includes("Krebs cycle"), "choosing a student shows their notes for the class");
  await t.click(".work-notes button"); await t.waitForSelector(".work-text");
  ok(/citrate/.test(await t.textContent(".work-text")), "and a note opens to its text, read-only");

  // ---- a live lesson: the teacher tells the class, the student is told
  await t.goto(BASE + "/classroom.html?view=library"); await t.waitForSelector(".reel-card");
  await t.click(".deck-open"); await t.waitForSelector(".slide-canvas");
  await t.click("text=Start live lesson"); await t.waitForSelector(".room-code", { timeout: 10000 });
  const room = (await t.textContent(".room-code")).trim();
  await t.waitForSelector(".tell-class button", { timeout: 8000 });
  ok(/AP Biology/.test(await t.textContent(".tell-class")), "the invite offers to tell the teacher's classes, beside the code");
  await t.click('.tell-class button:has-text("AP Biology")'); await t.waitForSelector('.tell-class button[aria-pressed="true"]');
  ok(rooms.rooms.get(room)?.classId === m.class_id, "telling a class ties the lesson to it on the server");

  await s.goto(BASE + "/"); await s.waitForSelector("#dial");
  await s.waitForSelector("#liveNotice", { timeout: 6000 });
  ok((await s.textContent("#liveNotice")).includes("AP Biology"), "the student gets a live notice at the side of the screen");
  await s.click("#discussionJoin"); await s.waitForSelector(".btab.live", { timeout: 6000 });
  ok(await s.isVisible(".btab.live .bdot") && await s.isVisible(".blive") && !(await s.$("#liveNotice")), "Classes shows it on the class's tab and page instead of the notice");
  await s.click("#bHome"); await s.waitForSelector("#liveNotice", { timeout: 6000 });
  await s.click("#lnJoin"); await s.waitForURL(/classroom\.html/);
  const j = new URL(s.url());
  ok(j.searchParams.get("room") === room && j.searchParams.get("name") === "Priya", "Join takes them into the lesson with the code and their name filled in");
  await s.goto(BASE + "/#classes"); await s.waitForSelector(".binder"); await s.waitForTimeout(2000);
  ok(!(await s.$("#liveNotice")), "a notice once acted on doesn't come back for the same lesson");

  // ---- leaving ends the teacher's view
  await s.click("#bLeave"); await s.click("#bLeaveYes");
  await s.waitForSelector('.btab.bjoin[aria-selected="true"]');
  ok(classes.members.length === 0 && !(await s.$('.btab:not(.bjoin)')), "a student can leave; the class is gone from their binder");
  await t.goto(BASE + "/classroom.html?view=classes"); await t.waitForSelector(".class-detail");
  ok(/No students yet/.test(await t.textContent(".class-detail")), "and from the teacher's roster, with their notes");

  // ---- every hover rule in the new screens sits behind a hover query
  const bare = await s.evaluate(() => [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } }).filter(r => r.selectorText && /\.(btab|bnotes)/.test(r.selectorText) && r.selectorText.includes(":hover")).length);
  ok(bare === 0, "the binder's hover styles only apply where there's a mouse");

  await b.close();
  if (errs.length) { console.error(`\n${errs.length} failed`); process.exit(1); }
  console.log("\nclasses: all good");
})().catch(e => { console.error(e); process.exit(1); });
