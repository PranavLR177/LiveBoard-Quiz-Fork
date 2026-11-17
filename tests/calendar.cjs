/* The calendar sheet in a real browser: the week strip, any day's panel, the kinds of entry (an exam that becomes the
   course's exam date, an event that repeats weekly with a time, a study session), planning reviews before a deadline,
   a note written for a day, and that it closes cleanly and keeps the chip current. Part of `npm test`. */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };
const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };

(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1366, 860], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("liveboard-role")) localStorage.setItem("liveboard-role", "student"); } catch {} });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${w}px pageerror: ${e.message}`));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
    await p.goto(BASE); await p.waitForSelector("#dial"); await p.waitForTimeout(1800);
    const tag = `(${w}px)`;

    await p.click("#calBtn"); await p.waitForSelector(".calsheet");
    ok((await p.$$(".cweek .cwk")).length === 7 && /Today/.test(await p.textContent(".cwk.isnow")), `the calendar opens big, with the next seven days across the top ${tag}`);
    const sheet = await p.$eval(".calsheet", e => { const r = e.getBoundingClientRect(); return { w: r.width / innerWidth, h: r.height / innerHeight }; });
    ok(sheet.w > 0.85 && sheet.h > 0.85, `and takes most of the screen ${tag} (${Math.round(sheet.w * 100)}% × ${Math.round(sheet.h * 100)}%)`);
    const scroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok(scroll, `nothing runs off the side ${tag}`);

    // any day: pick it, add to it
    const day3 = plus(3);
    await p.click(`.cweek [data-day="${day3}"]`); await p.waitForSelector(`.cweek [data-day="${day3}"][aria-pressed="true"]`);
    ok(/in 3 days/.test(await p.textContent(".cdaypanel h3")) && (await p.inputValue("#calDate")) === day3, `tapping a day opens it, ready to add to that day ${tag}`);
    await p.click('.ckinds [data-kind="event"]');
    await p.fill("#calTitle", "Lab section"); await p.fill("#calTime", "14:30"); await p.check("#calRepeat");
    await p.click("#calAdd .btn.primary"); await p.waitForSelector('.crow:has-text("Lab section")');
    ok(/2:30/.test(await p.textContent('.crow:has-text("Lab section") small')) && /every week/.test(await p.textContent('.crow:has-text("Lab section") small')), `an event keeps its time and says it repeats ${tag}`);
    await p.click(`.cday[data-day="${plus(10)}"]`).catch(async () => { await p.click('[data-cal="1"]'); await p.click(`.cday[data-day="${plus(10)}"]`); });
    await p.waitForSelector('.crow:has-text("Lab section")');
    ok(true, `and shows again a week later ${tag}`);

    // a deadline, then plan reviews before it
    const due = plus(9);
    await p.click(`.cday[data-day="${due}"]`).catch(async () => { await p.click('[data-cal="1"]'); await p.click(`.cday[data-day="${due}"]`); });
    await p.click('.ckinds [data-kind="deadline"]'); await p.fill("#calTitle", "Essay"); await p.click("#calAdd .btn.primary");
    await p.waitForSelector('.crow:has-text("Essay") .cplan');
    await p.click('.crow:has-text("Essay") .cplan'); await p.waitForTimeout(300);
    const reviews = await p.evaluate(() => [...document.querySelectorAll(".cday .cchip, .cwi")].filter(x => /Review: Essay/.test(x.textContent)).length);
    ok(reviews >= 2, `Plan reviews adds study sessions before the deadline ${tag} (${reviews} shown)`);

    // an exam for a course becomes that course's exam date
    await p.click(`.cweek [data-day="${plus(5)}"]`);
    await p.click('.ckinds [data-kind="exam"]'); await p.fill("#calTitle", "Midterm");
    const cid = await p.$eval("#calCourse option:nth-child(2)", o => o.value); await p.selectOption("#calCourse", cid);
    await p.click("#calAdd .btn.primary"); await p.waitForSelector('.crow[data-kind="exam"]');
    await p.keyboard.press("Escape"); await p.waitForSelector(".calsheet", { state: "detached" });
    ok(await p.isVisible(".examchip") && /5d/.test(await p.textContent(".examchip")), `an exam for a course sets its exam countdown and cram ${tag}`);

    // a note for a day
    await p.click("#calBtn"); await p.waitForSelector(".calsheet");
    await p.click(`.cweek [data-day="${plus(1)}"]`);
    await p.fill("#calTitle", "Reading notes"); await p.click("#calNote");
    await p.waitForSelector("#editor .ProseMirror");
    ok((await p.inputValue("#ptitle")) === "Reading notes", `Write a note for this day opens a new note ${tag}`);
    await p.click("#editor .ProseMirror"); await p.keyboard.type("Chapter 4."); await p.waitForTimeout(400);
    await p.goto(BASE); await p.waitForSelector("#dial"); await p.waitForTimeout(800);
    await p.click("#calBtn"); await p.waitForSelector(".calsheet"); await p.click(`.cweek [data-day="${plus(1)}"]`);
    ok(await p.isVisible('.crow[data-kind="note"]:has-text("Reading notes")'), `and keeps it on that day, a tap away ${tag}`);
    await p.click('.crow[data-kind="note"] .ctitle'); await p.waitForSelector("#editor .ProseMirror");
    const gone = await p.waitForSelector(".calsheet", { state: "detached", timeout: 2000 }).then(() => true, () => false);
    ok(gone && (await p.inputValue("#ptitle")) === "Reading notes", `opening it from the calendar closes the calendar ${tag}`);
    await ctx.close();
  }
  await b.close();
  if (errs.length) { console.error(`\n${errs.length} failed`); process.exit(1); }
  console.log("\nALL CALENDAR CHECKS PASS");
})().catch(e => { console.error(e); process.exit(1); });
