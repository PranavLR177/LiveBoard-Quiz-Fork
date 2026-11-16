/* The single-file preview holds the whole app in one page: the notes side and the classroom swap in place, since a
   single file can't have a second page. This builds that file and walks across both sides in a real browser, so the
   preview can't quietly lose the teacher side again. Part of `npm test`. */
const { chromium } = require("playwright");
const { execSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const errs = [];
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) errs.push(m); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-preview-")), file = path.join(dir, "preview.html");
  execSync("npx vite build", { env: { ...process.env, ARTIFACT: "1" }, stdio: "ignore" });
  execSync(`node scripts-artifact.mjs ${JSON.stringify(file)}`, { stdio: "ignore" });
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fs.readFileSync(file, "utf8")}</body></html>`;
  ok(Buffer.byteLength(page) < 16 * 1024 * 1024, `the preview fits the 16 MB limit for a published page (${(Buffer.byteLength(page) / 1048576).toFixed(1)} MB)`);
  const server = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page); }).listen(0);
  const BASE = "http://localhost:" + server.address().port + "/";
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(BASE); await p.waitForSelector(".welcome", { timeout: 30000 });
  await p.click('.wopt:has-text("Education")'); await p.click('.wopt:has-text("Education")');
  await p.click('.wopt:has-text("Teacher")'); await p.click('.wopt:has-text("Teacher")');
  await p.waitForSelector(".reel-card", { timeout: 20000 });
  ok(p.url() === BASE && await p.evaluate(() => document.querySelector(".app").hidden), "choosing Teacher on the welcome dial opens the classroom in the same page");
  await p.click(".deck-open"); await p.waitForSelector(".slide-canvas");
  await p.click(".lb-back"); await p.waitForSelector(".reel-card");
  ok(p.url() === BASE, "opening a presentation and coming back happen in place, with no page load");
  await p.click('.lb-top a:has-text("Worksheets")'); await p.waitForSelector(".teacher", { timeout: 10000 });
  ok(!(await p.$("#classroom-root")) && await p.evaluate(() => getComputedStyle(document.querySelector(".top")).display !== "none"), "Worksheets swaps back to the notes side with its own styles restored");
  await p.click("#devDot"); await p.click('#devSwitch [data-dev="student"]'); await p.waitForSelector(".fcard", { timeout: 15000 });
  ok(await p.isVisible("#discussionJoin"), "the developer switch goes to Student");
  await p.click('#devSwitch [data-dev="teacher"]'); await p.waitForSelector(".reel-card");
  ok(await p.evaluate(() => localStorage.getItem("liveboard-role")) === "teacher", "and to Teacher, which works in the preview too");
  await p.click('#devSwitch [data-dev="individual"]'); await p.waitForSelector(".fcard");
  ok(!(await p.isVisible("#discussionJoin")) && !(await p.$("#classroom-root")), "and to Just me");
  await p.click('#devSwitch [data-dev="student"]'); await p.waitForSelector("#lbWrap");
  await p.click("#discussionJoin"); await p.waitForSelector(".join-card");
  await p.click('.lb-top a:has-text("My notes")'); await p.waitForSelector(".fcard");
  ok(true, "Join class opens the join screen in place and My notes comes back");
  await b.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(errs.length ? "\nFAILURES:\n" + errs.join("\n") : "\nALL PREVIEW CHECKS PASS");
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
