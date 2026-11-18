/* Folders by subject in a real browser: the rotunda that peeks from the right edge of the home screen, turning it, the
   sheet it opens with every course or notebook, opening one to its notes, a new note made in it, searching, and that
   Esc goes back a step at a time. Part of `npm test`. */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };

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

    // the wheel peeks from the right edge, mostly off screen
    const r = await p.$eval("#rotunda", e => { const x = e.getBoundingClientRect(); return { left: x.left, right: x.right, n: e.querySelectorAll(".rtab").length, hub: e.querySelector(".rhub b").textContent }; });
    ok(r.right > w && r.left < w && w - r.left < 130 && r.n === 1 && r.hub === "1", `a small wheel of folder tabs peeks from the right edge ${tag}`);

    // a new folder from the sheet
    await p.click("#rotunda"); await p.waitForSelector(".fspanel .fscard");
    ok((await p.$$(".fscard")).length === 1 && /Your courses/.test(await p.textContent("#fsTitle")), `tapping it opens every course, outside time ${tag}`);
    const wide = await p.$eval(".fspanel", e => e.getBoundingClientRect().width / innerWidth);
    ok(wide > 0.85 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `the sheet takes most of the screen and nothing runs off the side ${tag}`);
    await p.click("#fsNew"); await p.waitForSelector("#feNameIn");
    ok(!(await p.$("#folderSheet")), `New folder hands over to the folder editor ${tag}`);
    await p.fill("#feNameIn", "Calculus"); await p.click("#feSave");
    await p.waitForFunction(() => document.querySelector("#rotunda .rhub b")?.textContent === "2");
    ok((await p.$$("#rotunda .rtab")).length === 2, `the wheel gains a tab for it ${tag}`);

    // turning the wheel
    if (w > 600) {
      await p.hover("#rotunda"); await p.mouse.wheel(0, 200); await p.waitForTimeout(200);
      ok(await p.$eval("#rotunda .rring", e => e.style.getPropertyValue("--turn") !== "" && e.style.getPropertyValue("--turn") !== "0deg"), `a scroll over it turns the wheel ${tag}`);
    }

    // open a folder, make a note in it
    await p.click("#rotunda"); await p.waitForSelector('.fscard:has-text("Calculus")');
    await p.click('.fscard:has-text("Calculus")'); await p.waitForSelector("#fsNewNote");
    ok(/Calculus/.test(await p.textContent("#fsTitle")) && /Nothing in here yet/.test(await p.textContent("#fsNotes")), `a folder opens in place to its notes ${tag}`);
    await p.keyboard.press("Escape"); await p.waitForSelector("#fsNew");
    ok(!!(await p.$("#folderSheet")) && (await p.$$(".fscard")).length === 2, `Esc goes back to all folders first ${tag}`);
    await p.click('.fscard:has-text("Calculus")'); await p.waitForSelector("#fsNewNote");
    await p.click("#fsNewNote"); await p.waitForSelector("#editor .ProseMirror");
    ok(!(await p.$("#rotunda")) && !(await p.$("#folderSheet")), `New note here opens a note, and the wheel stays on the home screen ${tag}`);
    await p.click("#editor .ProseMirror"); await p.keyboard.type("Limits and continuity");
    await p.waitForTimeout(700);
    await p.click("#backBtn"); await p.waitForSelector("#dial"); await p.waitForTimeout(1500);

    // the note is in that folder, and search finds it from the top
    await p.click("#rotunda"); await p.waitForSelector(".fscard");
    ok(/1 note/.test(await p.textContent('.fscard:has-text("Calculus")')), `the new note was made in that folder ${tag}`);
    await p.fill("#fsQ", "calc");
    ok((await p.$$(".fscard")).length === 1 && (await p.$$(".fsnote")).length >= 0, `search narrows the folders ${tag}`);
    await p.fill("#fsQ", "start here");
    ok((await p.$$(".fscard")).length === 0 && (await p.$$(".fsnote")).length === 1, `and finds notes by title across folders ${tag}`);
    await p.click(".fsnote"); await p.waitForSelector("#editor .ProseMirror");
    ok(/Start here/.test(await p.inputValue("#ptitle")), `a note opens straight from the sheet ${tag}`);
    await p.click("#backBtn"); await p.waitForSelector("#dial"); await p.waitForTimeout(1500);

    // Esc closes it; the wheel comes back
    await p.click("#rotunda"); await p.waitForSelector(".fscard");
    await p.keyboard.press("Escape"); await p.waitForSelector(".fsback", { state: "detached" });
    await p.waitForTimeout(500);
    ok(await p.$eval("#rotunda", e => !e.classList.contains("out")), `Esc closes it and the wheel is back ${tag}`);
    await ctx.close();
  }

  // reduced motion: everything still works, without the flourishes
  const ctx = await b.newContext({ viewport: { width: 1000, height: 760 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { localStorage.setItem("liveboard-role", "individual"); } catch {} });
  const p = await ctx.newPage(); p.on("pageerror", e => errs.push(`reduced pageerror: ${e.message}`));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(BASE); await p.waitForSelector("#dial"); await p.waitForTimeout(800);
  await p.click("#rotunda"); await p.waitForSelector(".fscard");
  ok(/Your notebooks/.test(await p.textContent("#fsTitle")), "on your own, they're notebooks; it opens with reduced motion too");
  await p.click(".fscard"); await p.waitForSelector("#fsNewNote");
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForSelector(".fsback", { state: "detached" });
  ok(true, "and closes with reduced motion");
  await b.close();
  if (errs.length) { console.error(`\n${errs.length} failure(s):\n` + errs.join("\n")); process.exit(1); }
  console.log("\nfolders: all passed");
})().catch(e => { console.error(e); process.exit(1); });
