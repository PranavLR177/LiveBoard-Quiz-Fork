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
  // pings travel over the faked Realtime socket, only to the class's members (row level security on class_pings)
  classes.onPing = (type, row, table = "class_pings") => fake.push(table, type, row, type === "DELETE" ? row : {});
  fake.canSee = (uid, table, row) => (table === "class_pings" || table === "class_quizzes") && classes.member(uid, row.class_id);
  const myClassesCalls = () => fake.calls.filter(c => c.endsWith("/rpc/my_classes")).length;

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

  // ---- a live lesson: the teacher tells the class and the student is pinged, with nothing polling
  await s.goto(BASE + "/"); await s.waitForSelector("#dial");
  for (let i = 0; i < 40 && !fake.listening("class_pings"); i++) await s.waitForTimeout(150);
  ok(fake.listening("class_pings"), "a signed-in student listens for class pings over Realtime");
  await t.goto(BASE + "/classroom.html?view=library"); await t.waitForSelector(".reel-card");
  await t.click(".deck-open"); await t.waitForSelector(".slide-canvas");
  await t.click("text=Start live lesson"); await t.waitForSelector(".room-code", { timeout: 10000 });
  const room = (await t.textContent(".room-code")).trim();
  await t.waitForSelector(".tell-class button", { timeout: 8000 });
  ok(/AP Biology/.test(await t.textContent(".tell-class")), "the invite offers to tell the teacher's classes, beside the code");
  ok(!(await s.$("#liveNotice")), "no notice before the teacher tells the class");
  const before = myClassesCalls();
  await t.click('.tell-class button:has-text("AP Biology")'); await t.waitForSelector('.tell-class button[aria-pressed="true"]');
  ok(rooms.rooms.get(room)?.classId === m.class_id, "telling a class ties the lesson to it on the server");
  await s.waitForSelector("#liveNotice", { timeout: 4000 });
  ok((await s.textContent("#liveNotice")).includes("AP Biology"), "the student is pinged at once: a live notice at the side of the screen, no reload");
  await s.waitForTimeout(3000);
  ok(myClassesCalls() === before, "and nothing asked the server for it (" + (myClassesCalls() - before) + " extra calls)");
  await s.click("#discussionJoin"); await s.waitForSelector(".btab.live", { timeout: 6000 });
  ok(await s.isVisible(".btab.live .bdot") && await s.isVisible(".blive") && !(await s.$("#liveNotice")), "Classes shows it on the class's tab and page instead of the notice");
  classes.onPing("DELETE", { class_id: m.class_id }); // the lesson ends: deleting the room deletes its ping
  await s.waitForSelector(".btab.live", { state: "detached", timeout: 4000 });
  ok(!(await s.$(".blive")), "when the lesson ends, the class stops showing live without a reload");
  classes.onPing("INSERT", { class_id: m.class_id, room, title: "Equilibrium" });
  await s.waitForSelector(".blive", { timeout: 4000 });
  await s.click("#bHome"); await s.waitForSelector("#liveNotice", { timeout: 6000 });
  await s.click("#lnJoin"); await s.waitForURL(/classroom\.html/);
  const j = new URL(s.url());
  ok(j.searchParams.get("room") === room && j.searchParams.get("name") === "Priya", "Join takes them into the lesson with the code and their name filled in");
  await s.goto(BASE + "/#classes"); await s.waitForSelector(".binder"); await s.goto(BASE + "/"); await s.waitForSelector("#dial"); await s.waitForTimeout(2000);
  ok(!(await s.$("#liveNotice")), "a notice once acted on doesn't come back for the same lesson");
  await s.goto(BASE + "/#classes"); await s.waitForSelector(".binder");

  // ---- a pop quiz: the teacher releases it, the student is pinged, takes it in recall, the teacher sees the result
  await s.goto(BASE + "/"); await s.waitForSelector("#dial");
  for (let i = 0; i < 40 && !fake.listening("class_quizzes"); i++) await s.waitForTimeout(150);
  await t.goto(BASE + "/classroom.html?view=classes"); await t.waitForSelector(".class-detail");
  await t.click('.class-tabs [role="tab"]:has-text("Pop quizzes")'); await t.waitForSelector(".quiz-panel");
  await t.click('.quiz-panel button:has-text("New pop quiz")'); await t.waitForSelector(".quiz-modal");
  await t.fill('.quiz-modal input[placeholder^="e.g."]', "Krebs check");
  const qb = n => `.quiz-qs .qb:nth-child(${n})`;
  ok(/Short answer/.test(await t.textContent(`${qb(1)} .qb-kinds [aria-checked="true"]`)) && /Multiple choice/.test(await t.textContent(`${qb(2)} .qb-kinds [aria-checked="true"]`)), "the builder offers short answer, multiple choice and true or false");
  // 1: short answer, with a picture
  await t.fill(`${qb(1)} .qb-body > textarea:first-of-type`, "What does citrate come from?");
  await t.fill(`${qb(1)} .qb-body > textarea:last-of-type`, "Acetyl-CoA joining oxaloacetate");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR4nGP8z8Dwn4ECwESJ5lEDRg0YNWDUgFEDRg0YNYBqBgAzRAMdMg3cOgAAAABJRU5ErkJggg==", "base64");
  await t.setInputFiles(`${qb(1)} input[type="file"]`, { name: "cell.png", mimeType: "image/png", buffer: png });
  await t.waitForSelector(`${qb(1)} .qb-img img`);
  ok(/^data:image\/jpeg;base64,/.test(await t.getAttribute(`${qb(1)} .qb-img img`, "src")), "a picture is shrunk on the teacher's device and shown in the question");
  // 2: multiple choice; it won't release until the right option is marked
  await t.fill(`${qb(2)} .qb-body > textarea:first-of-type`, "Where does the Krebs cycle happen?");
  for (const [k, v] of [[1, "Cytoplasm"], [2, "Mitochondrial matrix"], [3, "Nucleus"]]) await t.fill(`${qb(2)} .qb-opt:nth-child(${k}) input`, v);
  await t.click('.quiz-modal button.primary');
  ok(/Question 2: Mark the right option/.test(await t.textContent(".quiz-modal")) && classes.quizzes.length === 0, "it won't release a multiple choice question with no right answer marked");
  await t.click(`${qb(2)} .qb-opt:nth-child(2) button[role="radio"]`);
  await t.fill(`${qb(2)} .qb-body > textarea:last-of-type`, "The matrix, inside the inner membrane");
  // 3: true or false
  await t.click('.quiz-adds button:has-text("True or false")');
  await t.fill(`${qb(3)} .qb-body > textarea:first-of-type`, "The Krebs cycle needs light");
  await t.click(`${qb(3)} .qb-tf button:has-text("False")`);
  ok(await t.isChecked(".quiz-check input") && !(await t.isChecked(".quiz-check:nth-child(2) input")), "a new pop quiz is required, and not shuffled, unless the teacher says otherwise");
  await t.click('.quiz-modal button.primary'); await t.waitForSelector('.quiz-card:has-text("Krebs check")');
  const made = classes.quizzes[0];
  ok(/0 of 1 done/.test(await t.textContent(".quiz-card")) && made.questions.map(q => q.type).join() === "short,choice,tf" && made.questions[1].correct === 1 && made.questions[1].options.length === 3 && made.questions[2].correct === 1 && !!made.questions[0].img, "releasing it keeps each kind, the right answers, only the filled options, and the picture");
  await s.waitForSelector("#quizNotice", { timeout: 5000 });
  ok(/Krebs check/.test(await s.textContent("#quizNotice")) && /required/.test(await s.textContent("#quizNotice")), "the student is pinged at once: a card says a required pop quiz arrived");
  await s.waitForSelector('#recallSlip[data-state="quiz"]', { timeout: 4000 });
  ok(/Quiz/.test(await s.textContent("#recallSlip")) && await s.isEnabled("#recallSlip"), "and the recall slip leads with it");
  await s.click("#qnGo"); await s.waitForSelector("#recallSheet .quizcard");
  ok(/Pop quiz/.test(await s.textContent("#recallSheet .rskick")) && /citrate/.test(await s.textContent(".rq")) && await s.isVisible(".quizcard .qimg img"), "Take it opens the quiz in the recall sheet, picture and all");
  await s.fill("#rAns", "acetyl-CoA and oxaloacetate"); await s.click("#reveal"); await s.waitForSelector(".racts .got");
  ok(/Acetyl-CoA/.test(await s.textContent(".ra")), "showing a short answer shows the teacher's");
  await s.click(".racts .got"); await s.waitForSelector(".qopts.choice .qopt");
  ok((await s.$$(".qopts.choice .qopt")).length === 3, "a multiple choice question shows its options");
  await s.click('.qopt:has-text("Cytoplasm")'); await s.waitForSelector(".qopt.wrong");
  ok(/Mitochondrial matrix/.test(await s.textContent(".qopt.right")) && /Not quite/.test(await s.textContent(".qverdict")) && /inner membrane/.test(await s.textContent(".ra")), "picking marks it at once: the pick, the right one, and the why");
  await s.click("#qNextQ"); await s.waitForSelector(".qopts.tf .qopt");
  await s.keyboard.press("f"); await s.waitForSelector(".qopt.right");
  ok(/Right/.test(await s.textContent(".qverdict")), "true or false can be answered from the keyboard (T or F)");
  await s.click("#qNextQ");
  await s.waitForSelector(".quizdone");
  ok(/2 \/ 3/.test(await s.textContent(".quizdone .donebig")) && /Sent to Ms Rivera/.test(await s.textContent(".quizdone")), "at the end it's scored and sent");
  const res = classes.results[0];
  ok(res && res.score === 2 && res.total === 3 && res.answers[1].pick === 0 && res.answers[1].got === false && res.answers[2].pick === 1 && res.answers[2].got === true, "the server marks the choices from what was picked");
  await s.click("#doneBtn"); await s.waitForSelector("#recallSheet", { state: "detached" });
  ok(await s.$eval("#recallSlip", e => e.dataset.state !== "quiz"), "a quiz taken stops leading the slip");
  await t.reload(); await t.click('.class-tabs [role="tab"]:has-text("Pop quizzes")'); await t.waitForSelector('.quiz-card:has-text("Krebs check")');
  ok(/1 of 1 done/.test(await t.textContent(".quiz-card")) && /67%/.test(await t.textContent(".quiz-card .quiz-avg")), "the teacher sees it done, with the average");
  await t.click(".quiz-row"); await t.waitForSelector(".quiz-results table");
  ok(/Priya/.test(await t.textContent(".quiz-results")) && /2 \/ 3/.test(await t.textContent(".quiz-results")) && /A\. Cytoplasm/.test(await t.textContent(".quiz-said")) && /B\. False/.test(await t.textContent(".quiz-said")), "and each student's score, what they said and what they picked");
  await s.goto(BASE + "/#classes"); await s.waitForSelector(".bquiz");
  ok(/Krebs check/.test(await s.textContent(".bquiz")) && /2 \/ 3/.test(await s.textContent(".bquiz")), "the class's page in the binder lists it, with the score");

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
