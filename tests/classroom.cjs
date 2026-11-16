/* The classroom side of LiveBoard (/classroom.html) in a real browser: a teacher's home, the shared look in light and
   dark, a live class with a student on LiveBoard's own server, the student-marker switch, ending a class, and a
   student's questions arriving in their notes. Runs against the sync-test build (Supabase at http://sb.test) with the
   live-class functions faked in tests/fake-rooms.cjs; tests/sql/check.sql checks the real ones. Part of `npm test`. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const { FakeRooms } = require("./fake-rooms.cjs");
const BASE = process.env.SYNC_URL || "http://localhost:4174";
const OUT = process.env.CLASSROOM_SHOTS || "";
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };
const shot = async (p, name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: `${OUT}/${name}.png` }); } };
const setRole = role => { try { if (!localStorage.getItem("liveboard-role")) localStorage.setItem("liveboard-role", role); } catch {} };
const tokens = p => p.evaluate(() => { const c = getComputedStyle(document.documentElement); return ["--desk", "--paper", "--ink", "--muted", "--line", "--cobalt", "--mark", "--good"].map(k => c.getPropertyValue(k).trim().toUpperCase()).join(" "); });

(async () => {
  const b = await chromium.launch();
  const rooms = new FakeRooms();
  const open = async (role, width) => {
    const ctx = await b.newContext({ viewport: { width, height: 860 }, serviceWorkers: "block", colorScheme: "light" });
    await ctx.addInitScript(setRole, role); await rooms.attach(ctx);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(role + " pageerror: " + e.message));
    return p;
  };

  // ---- a teacher's home, and one look across both sides
  const t = await open("teacher", 1440);
  await t.goto(BASE + "/"); await t.waitForSelector(".reel-card");
  const home = new URL(t.url());
  ok(home.origin === new URL(BASE).origin && home.pathname === "/classroom.html" && home.search === "?view=library", "a teacher opening LiveBoard lands on Presentations, on LiveBoard's own address, with nothing extra in the link");
  ok(await t.isVisible(".lb-top .lb-brand") && await t.isVisible('.lb-top a[aria-current="page"]:has-text("Presentations")') && await t.isVisible('.lb-top a:has-text("Worksheets")') && await t.isVisible('.lb-top a:has-text("Student notes")'), "the classroom has LiveBoard's top bar: wordmark, Presentations, Worksheets, light/dark, Student notes");
  ok(await t.evaluate(() => document.documentElement.dataset.theme) === "light", "with no choice made, the classroom follows the device's light or dark setting, like the notes side");
  const lightClass = await tokens(t);
  await t.click(".lb-iconbtn"); await t.waitForTimeout(150);
  ok(await t.evaluate(() => document.documentElement.dataset.theme === "dark" && localStorage.getItem("lb-theme") === "dark"), "the classroom's light/dark button sets LiveBoard's one theme choice");
  const darkClass = await tokens(t);
  await shot(t, "library-dark");
  const bareHover = await t.evaluate(() => [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } }).filter(r => r.selectorText && r.selectorText.includes(":hover")).length);
  ok(bareHover === 0, `classroom hover styles sit inside a hover media query, so taps on an iPad don't stick (${bareHover} outside)`);
  await t.click('.lb-top a:has-text("Worksheets")'); await t.waitForSelector(".teacher", { timeout: 15000 });
  ok(new URL(t.url()).hash === "#teacher" && await t.evaluate(() => document.documentElement.dataset.theme) === "dark", "Worksheets opens the worksheet studio in the notes side, already in the theme just chosen");
  const darkNotes = await tokens(t);
  await t.click("#themeBtn"); await t.waitForTimeout(150);
  const lightNotes = await tokens(t);
  ok(darkClass === darkNotes, "dark mode uses the same colours on both sides\n       classroom " + darkClass + "\n       notes     " + darkNotes);
  ok(lightClass === lightNotes, "light mode uses the same colours on both sides\n       classroom " + lightClass + "\n       notes     " + lightNotes);
  await t.click("#presentationsLink"); await t.waitForSelector(".reel-card");
  ok(await t.evaluate(() => document.documentElement.dataset.theme) === "light", "and the choice made on the notes side carries back to the classroom");
  await shot(t, "library-light");

  // ---- the home: the presentation in front shows its own slides on the tray; the others wait below
  const title = () => t.textContent(".reel-hub h2");
  const frontSlide = () => t.$eval(".reel-card.front .deck-cover", e => e.getAttribute("aria-label"));
  const firstDeck = await title(), slides = (await t.$$(".reel-strip button")).length;
  ok(slides >= 2 && /Slide 1/.test(await frontSlide()) && /Slide 1 of/.test(await t.textContent(".reel-strip span")), "the presentation in front has its slides on the tray, starting at slide 1");
  await t.focus(".reel"); await t.keyboard.press("ArrowRight"); await t.waitForTimeout(100);
  ok(/Slide 2/.test(await frontSlide()) && await title() === firstDeck && /at slide 2/.test(await t.textContent(".deck-open")), "the right arrow turns to its next slide, and Open offers to start there");
  await t.click(".reel-strip button >> nth=0"); await t.waitForTimeout(100);
  ok(/Slide 1/.test(await frontSlide()), "tapping a tick on the strip brings that slide round");
  const waiting = await t.textContent(".deck-peek >> nth=0");
  ok(await t.isVisible(".deck-below") && !waiting.includes(firstDeck), "the other presentations peek up from the bottom of the screen");
  await t.mouse.move(700, 400); await t.mouse.wheel(0, 240);
  await t.waitForFunction(was => document.querySelector(".reel-hub h2")?.textContent !== was, firstDeck, { timeout: 4000 }).catch(() => {});
  const secondDeck = await title();
  ok(secondDeck !== firstDeck && waiting.includes(secondDeck) && /Slide 1 of/.test(await t.textContent(".reel-strip span")), "scrolling down pulls the next presentation up to the front, on its first slide");
  ok((await t.textContent(".deck-above")).includes(firstDeck), "and the one that was in front waits just above");
  await t.waitForTimeout(500); await t.mouse.wheel(0, -240);
  await t.waitForFunction(was => document.querySelector(".reel-hub h2")?.textContent !== was, secondDeck, { timeout: 4000 }).catch(() => {});
  ok(await title() === firstDeck, "scrolling up brings it back");
  await t.click(".deck-peek >> nth=0"); await t.waitForTimeout(150);
  ok(await title() === secondDeck, "tapping the card that peeks up pulls it up too");
  await t.keyboard.press("ArrowUp"); await t.waitForTimeout(150);
  await t.fill(".reel-bar input", "zzzz no such deck");
  ok(await t.isVisible(".library-empty"), "searching for something that isn't there says so");
  await t.fill(".reel-bar input", ""); await t.waitForSelector(".reel-card.front");

  await t.focus(".reel"); await t.keyboard.press("ArrowDown"); await t.waitForTimeout(150); // open the second one, so it becomes the most recent
  // ---- open a deck and start a live class
  await t.click(".deck-open"); await t.waitForSelector(".slide-canvas");
  ok(!(await t.$(".topbar")) && /Saved on this device|not saved yet/.test(await t.textContent(".lb-status")), "the editor sits under the same top bar, which says where the deck is saved");
  const backBox = await t.locator(".lb-back").boundingBox();
  ok(await t.isVisible('.lb-back:has-text("All presentations")') && backBox.x < 400 && !(await t.$(".crumb")), "inside a presentation the way home is one solid button beside the wordmark");
  await t.click(".lb-back"); await t.waitForSelector(".reel-card");
  ok(await title() === secondDeck, "the presentation opened last is the one in front when you come back");
  ok(new URL(t.url()).search === "?view=library", "and it goes back to the presentations home");
  await t.click(".deck-open"); await t.waitForSelector(".slide-canvas");
  await t.click("text=Start live lesson"); await t.waitForSelector(".room-code", { timeout: 10000 });
  const code = (await t.textContent(".room-code")).trim();
  ok(/^[0-9A-F]{8}$/.test(code) && rooms.rooms.has(code) && rooms.calls.includes("room_create"), "Start live lesson makes the room on LiveBoard's own server (no second site)");
  const link = await t.evaluate(async () => { let got = ""; navigator.clipboard.writeText = async v => { got = v; }; document.querySelector(".modal .primary").click(); await new Promise(r => setTimeout(r, 100)); return got; });
  ok(link === BASE + "/classroom.html?room=" + code, "the student link the teacher copies opens the classroom, not the notes home (" + link + ")");
  await t.click(".modal-backdrop", { position: { x: 5, y: 5 } });
  ok((await t.textContent(".lb-status")).includes(code), "the room code stays in view in the top bar while the class is live");

  // ---- a student joins from their notes
  const s = await open("student", 1100);
  await s.goto(BASE + "/"); await s.waitForSelector(".fcard", { timeout: 15000 });
  ok((await s.$eval("#discussionJoin", e => e.textContent)) === "Join\u00a0class", "the header reads “Join class” with a space that the pill's layout can't swallow");
  await s.click("#discussionJoin"); await s.waitForSelector(".join-card");
  ok(new URL(s.url()).pathname === "/classroom.html" && await s.isVisible('.lb-top a:has-text("My notes")') && !(await s.$('.lb-top a:has-text("Worksheets")')), "Join class opens the join screen under the same top bar, with a way back to My notes and no teaching tools");
  await s.fill('input[placeholder="First name or nickname"]', "Maya");
  await s.fill('input[placeholder="8-character code"]', code.toLowerCase());
  await s.click("text=Join lesson"); await s.waitForSelector(".slide-canvas", { timeout: 10000 });
  ok(rooms.rooms.get(code).slides.some(x => x.notes) && await s.evaluate(() => !document.body.innerText.includes("Teacher notes")), "the student sees the slides; speaker notes stay with the teacher");

  const ask = async (page, text) => {
    await page.click('button:has-text("Drop a marker")'); await page.waitForSelector(".slide-canvas.placing");
    const box = await page.locator(".slide-canvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4);
    await page.waitForSelector(".composer textarea"); await page.fill(".composer textarea", text);
    await page.click(".composer .primary");
  };
  await ask(s, "Why does the slope change?");
  await t.waitForFunction(() => /1\s*student marker/.test(document.body.innerText), null, { timeout: 9000 }).then(() => ok(true, "the student's marker reaches the teacher within a few seconds"), () => ok(false, "the student's marker reaches the teacher within a few seconds"));

  // ---- the teacher pauses student markers: enforced by the server, not just hidden
  await t.click('button:has-text("Student markers")'); await t.waitForTimeout(400);
  ok(rooms.rooms.get(code).studentMarkers === 0, "the Student markers switch is saved on the server");
  let refused = "";
  try { rooms.act({ p_room: code, p_action: "marker", p_data: { kind: "question", body: "sneaky", slide: 0, x: 50, y: 50 }, p_secret: null, p_participant: "x" }); } catch (e) { refused = e.message; }
  ok(/paused/.test(refused), "while paused the server refuses a student's marker even if their screen is bypassed");
  await t.click('button:has-text("Student markers")'); await t.waitForTimeout(400);

  // ---- the teacher answers; the student keeps it in their notes
  const mid = rooms.rooms.get(code).markers[0].id;
  rooms.act({ p_room: code, p_action: "reply", p_data: { id: mid, body: "Because the curve bends: the tangent turns with it." }, p_secret: rooms.rooms.get(code).secret });
  await s.waitForSelector("text=the tangent turns with it", { timeout: 9000 }); // the answer arrives on the student's screen
  await shot(s, "student-live"); await shot(t, "teacher-live");
  const closeBtn = await s.$('[aria-label="Back to marker overview"]'); if (closeBtn && await closeBtn.isVisible()) await closeBtn.click();
  await s.click("text=Add to my notes");
  ok(await s.evaluate(() => JSON.parse(localStorage.getItem("lb-class-notes") || "[]").length) === 1, "Add to my notes hands the questions to the notes side");

  // ---- ending the class
  await t.click("text=End class"); await t.waitForSelector(".reel-card", { timeout: 10000 });
  ok(rooms.rooms.size === 0, "End class deletes the room, its slides and its markers from the server");
  await s.waitForSelector(".class-ended", { timeout: 9000 }).then(() => ok(true, "the student is told the class has ended and keeps what's on screen"), () => ok(false, "the student is told the class has ended and keeps what's on screen"));
  await s.click('.class-ended a'); await s.waitForSelector(".fcard", { timeout: 15000 });
  await s.waitForFunction(() => !localStorage.getItem("lb-class-notes"), null, { timeout: 8000 }).catch(() => {});
  const readKept = () => s.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) {
      if (!/^liveboard/.test(name) || /presentations|teacher/.test(name)) continue;
      const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      if (![...db.objectStoreNames].includes("notes")) { db.close(); continue; }
      const all = await new Promise(res => { const r = db.transaction("notes").objectStore("notes").getAll(); r.onsuccess = () => res(r.result); });
      db.close();
      const n = all.find(x => /my class questions/.test(x.title));
      if (n) return n.html || "";
    }
    return "";
  });
  let kept = "";
  for (let i = 0; i < 25 && !kept; i++) { kept = await readKept(); if (!kept) await s.waitForTimeout(300); }
  ok(/Why does the slope change\?/.test(kept) && /the tangent turns with it/.test(kept), "back in their notes, the questions and the teacher's answer are a new note");
  // a hostile answer can't smuggle markup into the note
  await s.evaluate(() => localStorage.setItem("lb-class-notes", JSON.stringify([{ title: "x <img src=x onerror=window.__pwned=1>", markdown: "<img src=x onerror=\"window.__pwned=1\"><script>window.__pwned=1</script>\n\n[link](javascript:window.__pwned=1)" }])));
  await s.reload(); await s.waitForSelector(".fcard", { timeout: 15000 }); await s.waitForTimeout(1200);
  ok(await s.evaluate(() => !window.__pwned && !localStorage.getItem("lb-class-notes")), "text handed over from a class is sanitised like any import: no script or image handler runs");

  await b.close();
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL CLASSROOM CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
