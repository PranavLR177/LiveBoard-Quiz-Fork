/* Focus in a real browser, with a fake clock so hours pass in a moment: setting any length on the dial or by typing,
   one block and cycles with breaks, pausing, +5, skipping a break, the quiet screen and held alerts, a goal that opens a
   note, surviving a reload, and the summary with minutes logged for the week. Part of `npm test`. */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };
const MIN = 60000;

(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1366, 860], [390, 844]]) {
    const tag = `(${w}px)`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block", reducedMotion: "reduce" }); // a fake clock would freeze the animations mid-way
    await ctx.addInitScript(() => { try { localStorage.setItem("liveboard-role", "student"); } catch {} });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(`${w}px pageerror: ${e.message}`));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
    await p.clock.install({ time: new Date("2026-11-18T15:00:00") });
    await p.goto(BASE); await p.waitForSelector("#dial"); await p.clock.runFor(2500);
    const chipText = () => p.textContent("#focusBtn .fbt").then(t => t.trim());

    // setup: the dial, typing, presets
    await p.click("#focusBtn"); await p.waitForSelector("#fStart");
    ok(await p.$eval(".fcsheet", e => { const r = e.getBoundingClientRect(); return r.width > innerWidth * 0.6 || innerWidth < 500; }) && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Focus opens as a large sheet, nothing off the side ${tag}`);
    await p.fill("#fMinsIn", "37");
    ok(/37 min/.test(await p.textContent("#fStart")) && (await p.getAttribute("#fcDialWrap", "aria-valuenow")) === "37", `any length can be typed in ${tag}`);
    const box = await p.$eval(".fcdial", e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width * 0.4 }; });
    await p.mouse.move(box.x + box.r * 0.7, box.y - box.r * 0.7); await p.mouse.down(); await p.mouse.move(box.x + box.r, box.y, { steps: 4 }); await p.mouse.up();
    ok((await p.inputValue("#fMinsIn")) === "30", `dragging the dial sets it, in 5 minute steps (${await p.inputValue("#fMinsIn")}) ${tag}`);
    await p.focus("#fcDialWrap"); await p.keyboard.press("ArrowUp");
    ok((await p.inputValue("#fMinsIn")) === "35", `arrow keys nudge it ${tag}`);
    await p.click('[data-min="25"]');

    // cycles: 2 rounds of 25 with 5 min breaks
    await p.click('[data-mode="cycles"]'); await p.click("#fRoundsDown"); await p.click("#fRoundsDown");
    ok(/2 × 25 min, 5 min breaks · 55 min in all/.test(await p.textContent("#fcSum")), `cycles show the whole plan ${tag}`);
    await p.fill("#fGoal", "Osmosis questions");
    const nid = await p.$eval("#fOpen option:nth-child(2)", o => o.value).catch(() => "");
    if (nid) await p.selectOption("#fOpen", nid);
    await p.click("#fStart"); await p.waitForSelector(".fcback", { state: "detached" });
    ok(/^2[45]:\d\d$/.test(await chipText()), `starting shows the countdown in the header ${tag}`);
    if (nid) { await p.waitForSelector("#editor .ProseMirror"); ok(true, `picking a note opens it when the session starts ${tag}`); }
    ok(await p.evaluate(() => document.body.classList.contains("focusquiet") && document.body.classList.contains("focushold")), `the screen goes quiet and alerts are held ${tag}`);
    ok(await p.$eval(".top #searchBtn", e => getComputedStyle(e).opacity === "0") && await p.isVisible("#focusBtn"), `only the timer stays in the header ${tag}`);

    // pause holds the clock
    await p.click("#focusBtn"); await p.waitForSelector("#fPause"); await p.click("#fPause");
    const held = await chipText(); await p.clock.runFor(3 * MIN);
    ok((await chipText()) === held && /paused/.test(held) && !(await p.evaluate(() => document.body.classList.contains("focusquiet"))), `pausing stops the clock and lifts the quiet screen (${held}) ${tag}`);
    await p.click("#fPause"); await p.click("#fAdd");
    ok(/^(29|30):\d\d$/.test(await p.textContent("#fcBig")), `resume, then +5 adds five minutes (${await p.textContent("#fcBig")}) ${tag}`);
    await p.keyboard.press("Escape"); await p.waitForSelector(".fcback", { state: "detached" });

    // the first block ends: a break
    await p.clock.runFor(30 * MIN + 5000);
    await p.waitForSelector(".focuscue.break");
    ok(/^Break \d:\d\d$/.test(await chipText()) && !(await p.evaluate(() => document.body.classList.contains("focusquiet"))), `the block ends in a break, and the screen wakes up (${await chipText()}) ${tag}`);
    // it survives a reload mid-break
    await p.reload(); await p.waitForSelector("#focusBtn"); await p.clock.runFor(1500);
    ok(/^Break/.test(await chipText()), `a reload keeps the session ${tag}`);
    await p.click("#focusBtn"); await p.waitForSelector("#fSkip"); await p.click("#fSkip");
    await p.waitForFunction(() => /Round 2 of 2/.test(document.querySelector(".fchead small")?.textContent || ""));
    ok(true, `skipping the break starts round 2 ${tag}`);
    await p.keyboard.press("Escape");

    // round 2 runs out: the summary, the goal, minutes logged
    await p.clock.runFor(26 * MIN);
    await p.waitForSelector(".sessiondone");
    const sum = await p.textContent(".sessiondone");
    ok(/5[45] min focused/.test(sum) && /2 of 2 rounds/.test(sum) && /Osmosis questions/.test(sum), `it ends with a summary: time focused, rounds, the goal (${sum.replace(/\s+/g, " ").slice(0, 90)}) ${tag}`);
    await p.click('.sessiondone [data-met="1"]');
    ok(!(await p.evaluate(() => document.body.classList.contains("focusing"))) && (await chipText()) === "Focus", `and the header goes back to Focus ${tag}`);
    await p.click("#focusBtn"); await p.waitForSelector("#fStart");
    ok(/5[45] min today/.test(await p.textContent(".fchead small")) && /5[45] min/.test(await p.textContent(".fcweektxt")), `the minutes count toward today and the week ${tag}`);
    ok((await p.inputValue("#fMinsIn")) === "25" && await p.getAttribute('[data-mode="cycles"]', "aria-checked") === "true", `it remembers the last setup ${tag}`);

    // a one-block session ended early
    await p.click('[data-mode="block"]'); await p.click('[data-min="15"]'); await p.click("#fStart");
    await p.clock.runFor(6 * MIN);
    await p.click("#focusBtn"); await p.click("#fEnd");
    await p.waitForSelector(".sessiondone");
    ok(/Session ended/.test(await p.textContent(".sessiondone")) && /6 min focused/.test(await p.textContent(".sessiondone")), `ending early counts what was focused ${tag}`);
    await ctx.close();
  }
  await b.close();
  if (errs.length) { console.error(`\n${errs.length} failure(s):\n` + errs.join("\n")); process.exit(1); }
  console.log("\nfocus: all passed");
})().catch(e => { console.error(e); process.exit(1); });
