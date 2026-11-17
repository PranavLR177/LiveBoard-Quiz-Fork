// The spoken-calendar parser (src/voiceDate.ts): plain rules, so dates come out exact. Runs in Node.
const assert = require("node:assert/strict");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const m = new Module("voiceDate", module); m.paths = module.paths;
m._compile(buildSync({ entryPoints: ["src/voiceDate.ts"], bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text, "voiceDate.cjs");
const { hear } = m.exports;
const now = new Date(2026, 10, 17, 9); // Tuesday 17 November 2026
const courses = [{ id: "bio", name: "BIO 101" }, { id: "econ", name: "ECON 101" }, { id: "chem", name: "Chemistry" }];
const cases = [
  ["bio lab report due next thursday", { title: "Lab report", date: "2026-11-26", courseId: "bio" }],
  ["Lab report due Thursday", { title: "Lab report", date: "2026-11-19" }],
  ["econ problem set due friday at 5pm", { title: "Problem set", date: "2026-11-20", courseId: "econ" }],
  ["chemistry midterm on December 3rd", { title: "Midterm", date: "2026-12-03", courseId: "chem" }],
  ["essay draft tomorrow", { title: "Essay draft", date: "2026-11-18" }],
  ["add study group the day after tomorrow", { title: "Study group", date: "2026-11-19" }],
  ["read chapter 4 in two weeks", { title: "Read chapter 4", date: "2026-12-01" }],
  ["remind me to pay rent on the 1st", { title: "Pay rent", date: "2026-12-01" }],
  ["final exam 12/14", { title: "Final exam", date: "2026-12-14" }],
  ["project demo the 21st of november", { title: "Project demo", date: "2026-11-21" }],
  ["quiz next monday", { title: "Quiz", date: "2026-11-23" }],
  ["call home tonight", { title: "Call home", date: "2026-11-17" }],
  ["submit application end of the month", { title: "Submit application", date: "2026-11-30" }],
  ["dentist january 5", { title: "Dentist", date: "2027-01-05" }],
  ["bio101 reading in 3 days", { title: "Reading", date: "2026-11-20", courseId: "bio" }],
  ["something with no date at all", { title: "Something with no date at all", date: null }]
];
for (const [said, want] of cases) {
  const got = hear(said, courses, now);
  for (const k of Object.keys(want)) assert.equal(got[k], want[k], `${JSON.stringify(said)} → ${k}: ${JSON.stringify(got)}`);
  if (!("courseId" in want)) assert.equal(got.courseId, null, `${said}: no course`);
}
// what it is, when in the day, and whether it repeats
const more = [
  ["chem midterm december 3rd at 2pm", { title: "Midterm", kind: "exam", time: "14:00", courseId: "chem", date: "2026-12-03" }],
  ["study group every wednesday at 7", { title: "Study group", kind: "study", time: "19:00", repeat: "weekly", date: "2026-11-18" }],
  ["dentist appointment friday at 10:30 am", { title: "Dentist appointment", kind: "event", time: "10:30", date: "2026-11-20" }],
  ["econ lecture every monday at noon", { title: "Lecture", kind: "event", time: "12:00", repeat: "weekly", courseId: "econ", date: "2026-11-23" }],
  ["essay due friday", { kind: "deadline", time: null, repeat: null }]
];
for (const [said, want] of more) {
  const got = hear(said, courses, now);
  for (const k of Object.keys(want)) assert.equal(got[k], want[k], `${JSON.stringify(said)} → ${k}: ${JSON.stringify(got)}`);
}
// on a Friday, "next tuesday" is four days on, not eleven
assert.equal(hear("quiz next tuesday", [], new Date(2026, 10, 20, 9)).date, "2026-11-24");
console.log(`PASS: ${cases.length + more.length + 1} spoken dates, titles and courses read exactly (relative days, weekdays, "next", month names, ordinals, numeric dates, end of week/month, times, kinds, weekly repeats).`);
