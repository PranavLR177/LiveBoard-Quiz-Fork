/* Voice in a real browser, with the browser's speech recognition and speech replaced by a script (Chromium in a test
   has no microphone): the calendar takes a spoken deadline from its Say it bar and from holding the chip, asks for a
   day when none was said, and can undo; recall fills its key-idea beads as you speak and turns the card over on a
   pause; Out loud reads the question, takes the answer and grades on "got it". Part of `npm test`. */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };

const FAKE = () => {
  window.__spoken = [];
  class FakeRec {
    constructor() { this.results = []; this.onresult = this.onerror = this.onend = null; window.__rec = this; }
    start() { window.__listening = (window.__listening || 0) + 1; window.__live = this; }
    stop() { if (window.__live === this) window.__live = null; setTimeout(() => this.onend?.(), 0); }
    abort() { this.stop(); }
  }
  window.webkitSpeechRecognition = FakeRec;
  window.SpeechRecognition = undefined;
  // words arrive as the browser sends them: a settled result, or one still being heard (replaced by the next)
  window.__say = (text, final = true) => {
    const r = window.__live; if (!r) return false;
    const last = r.results[r.results.length - 1];
    const res = Object.assign([{ transcript: text }], { isFinal: final });
    let idx = r.results.length;
    if (last && !last.isFinal) { idx = r.results.length - 1; r.results[idx] = res; } else r.results.push(res);
    r.onresult?.({ resultIndex: idx, results: r.results });
    return true;
  };
  const synth = { speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 30); }, cancel() {}, getVoices: () => [] };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem("liveboard-role")) localStorage.setItem("liveboard-role", "student"); } catch {} });
  await ctx.addInitScript(FAKE);
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.route("**/api/marker", r => r.fulfill({ json: { ai: false } }));
  const say = (t, final = true) => p.evaluate(([t, f]) => window.__say(t, f), [t, final]);
  const listening = () => p.evaluate(() => !!window.__live);

  await p.goto(BASE); await p.waitForSelector("#dial"); await p.waitForTimeout(2200);

  // ---- the calendar: Say it
  await p.click("#calBtn"); await p.waitForSelector(".calsheet #calVoice");
  await p.click("#calVoice");
  ok(await listening(), "Say it starts listening");
  await say("essay draft due next", false);
  await say("essay draft due next thursday", true);
  await p.waitForSelector("#calHeard .vday");
  ok(/Essay draft/.test(await p.textContent("#calHeard .vparse b")) && /Thu/.test(await p.textContent("#calHeard .vday")), "what's understood shows while you speak: the title and the day");
  await p.waitForSelector("#calHeard .vdone", { timeout: 4000 }); // a pause ends it
  ok(/Added/.test(await p.textContent("#calHeard .vdone")) && (await p.$$eval(".callist .ctitle", xs => xs.map(x => x.textContent))).includes("Essay draft"), "after a pause it's added to the calendar");
  ok(!!(await p.$(".cday.landed")), "and lands on its day in the grid");
  await p.click("#calHeard [data-undo]"); await p.waitForTimeout(300);
  ok(!(await p.$$eval(".callist .ctitle", xs => xs.map(x => x.textContent))).includes("Essay draft"), "Undo takes it back off");

  await p.click("#calVoice"); await say("call the advisor"); await p.waitForSelector("#calHeard .vdone", { timeout: 4000 });
  ok(/No day heard/.test(await p.textContent("#calHeard .vdone")) && (await p.inputValue("#calTitle")) === "Call the advisor", "with no day said, it fills in the title and asks for the day instead of guessing");

  // ---- the calendar: hold the chip
  await p.keyboard.press("Escape"); await p.waitForSelector(".calsheet", { state: "detached" });
  const chip = await p.$("#calBtn"), box = await chip.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(600);
  ok(await listening() && await p.isVisible("#calHold"), "holding the calendar chip listens, with a bubble under it");
  await say("problem set in 3 days");
  await p.mouse.up();
  await p.waitForSelector("#calHold .vdone", { timeout: 3000 });
  ok(/Added/.test(await p.textContent("#calHold")) && !(await p.$(".calsheet")), "letting go adds it, without opening the calendar");
  await p.click("#calBtn"); await p.waitForSelector(".calsheet");
  ok((await p.$$eval(".callist .ctitle", xs => xs.map(x => x.textContent))).includes("Problem set"), "and it's in the calendar");
  await p.keyboard.press("Escape");

  // ---- recall: say it back
  await p.clock.setSystemTime(Date.now() + 26 * 3600e3);
  await p.reload(); await p.waitForSelector("#recallSlip:not([disabled])", { timeout: 10000 });
  await p.click("#recallSlip"); await p.waitForSelector("#rMic"); await p.waitForTimeout(700);
  const total = +(await p.getAttribute("#rBeads", "data-total") || 0);
  await p.click("#rMic");
  ok(await listening() && await p.isVisible(".rscard.listening"), "the mic beside the answer listens");
  const answer = await p.evaluate(() => [...document.querySelectorAll("#rBeads i")].length);
  await say("markers you select text and type what you want", false);
  const lit = await p.$$eval("#rBeads i.hit", xs => xs.length);
  ok(total < 2 || lit > 0, `the key-idea beads fill as you speak, without showing the answer (${lit} of ${answer})`);
  await say("markers you select text and type what you want", true);
  await p.waitForSelector(".racts .got", { timeout: 4000 });
  ok(/You said/.test(await p.textContent(".ryou")) && !!(await p.$(".ra mark.hit")), "a pause turns the card over, with what you said marked against the answer");

  // ---- recall: out loud
  await p.click(".racts .again"); await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.waitForTimeout(700);
  await p.clock.setSystemTime(Date.now() + 2 * 26 * 3600e3); // a day on, it's due again
  await p.reload(); await p.waitForSelector("#recallSlip:not([disabled])", { timeout: 10000 });
  await p.click("#recallSlip"); await p.waitForSelector("#rsLoud"); await p.waitForTimeout(600);
  await p.click("#rsLoud");
  for (let i = 0; i < 30 && !(await listening()); i++) await p.waitForTimeout(100);
  const q = await p.textContent(".rq");
  ok((await p.evaluate(() => window.__spoken)).includes(q) && await listening(), "Out loud reads the question and then listens");
  await say("one tool, markers");
  await p.waitForSelector(".racts .got", { timeout: 5000 });
  for (let i = 0; i < 30 && !(await listening()); i++) await p.waitForTimeout(100);
  ok((await p.evaluate(() => window.__spoken.at(-1))).includes("Got it, or again?") && await listening(), "it reads the answer back and asks: got it, or again?");
  await say("got it");
  await p.waitForSelector(".rscard.done, .rscard:not(.back)", { timeout: 5000 }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector(".racts .got")), "“got it” grades the card and moves on");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
  ok(!(await listening()), "closing recall stops listening");

  await b.close();
  if (errs.length) { console.error(`\n${errs.length} failed`); process.exit(1); }
  console.log("\nALL VOICE CHECKS PASS");
})().catch(e => { console.error(e); process.exit(1); });
