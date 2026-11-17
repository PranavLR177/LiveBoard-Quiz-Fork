/* Turns a spoken sentence into a calendar entry: "bio lab report due next thursday" → title "Lab report", the date of
   next Thursday, the Bio course. Plain rules, no AI: it runs offline, instantly, and gets dates exactly right. If no
   date is said it says so (date: null) and the calendar asks, rather than guessing. Pure, so tests/voice.cjs runs it
   in Node. */

export type Heard = { title: string; date: string | null; courseId: string | null; said: string;
  /** What it is, from the words used: an exam, an event (a class, a meeting), a study session, or else a deadline. */
  kind: "deadline" | "exam" | "event" | "study"; time: string | null; repeat: "weekly" | null };
type CourseLike = { id: string; name: string };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, couple: 2, few: 3 };
const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21, "twenty-second": 22, "twenty-third": 23, "twenty-fourth": 24, "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27, "twenty-eighth": 28, "twenty-ninth": 29, thirtieth: 30, "thirty-first": 31 };

export const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** A day of the month said without a month: the next time that day comes round (today counts). */
function nextDayOfMonth(now: Date, day: number) {
  for (let k = 0; k < 13; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, day);
    if (d.getDate() === day && keyOf(d) >= keyOf(now)) return d;
  }
  return null;
}
/** A month and day: this year, or next year if it has passed. */
function monthDay(now: Date, m: number, day: number) {
  let d = new Date(now.getFullYear(), m, day);
  if (d.getMonth() !== m) return null;
  if (keyOf(d) < keyOf(now)) d = new Date(now.getFullYear() + 1, m, day);
  return d;
}

/** Reads a date out of `text`. Returns the date and the words that said it (to take out of the title). */
export function findDate(text: string, now = new Date()): { date: Date; span: string } | null {
  const low = ` ${text.toLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim()} `;
  const tests: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
    [/ (?:the )?day after tomorrow /, () => addDays(now, 2)],
    [/ (?:today|tonight|this (?:morning|afternoon|evening)) /, () => now],
    [/ tomorrow(?: (?:morning|afternoon|night|evening))? /, () => addDays(now, 1)],
    [/ in (\d+|[a-z]+) (day|days|week|weeks)(?: time)? /, m => { const n = /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]]; return n ? addDays(now, n * (m[2].startsWith("week") ? 7 : 1)) : null; }],
    [/ (?:a |one )?week from (?:today|now) /, () => addDays(now, 7)],
    [/ (?:at the )?end of (?:the |this )?week /, () => addDays(now, (5 - now.getDay() + 7) % 7)],
    [/ (?:at the )?end of (?:the |this )?month /, () => new Date(now.getFullYear(), now.getMonth() + 1, 0)],
    [/ next week /, () => addDays(now, ((1 - now.getDay() + 7) % 7) || 7)],
    // "november 21", "nov 21st", "21st of november", "the 21st of nov"
    [new RegExp(` (${MONTHS.map(m => m.slice(0, 3) + "[a-z]*").join("|")}) (\\d{1,2})(?:st|nd|rd|th)? `), m => monthDay(now, MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3))), +m[2])],
    [new RegExp(` (?:the )?(\\d{1,2})(?:st|nd|rd|th)? of (${MONTHS.map(m => m.slice(0, 3) + "[a-z]*").join("|")}) `), m => monthDay(now, MONTHS.findIndex(x => x.startsWith(m[2].slice(0, 3))), +m[1])],
    [new RegExp(` (${MONTHS.join("|")}) (${Object.keys(ORD).join("|")}) `), m => monthDay(now, MONTHS.indexOf(m[1]), ORD[m[2]])],
    // "11/21" (month first, as said in the US)
    [/ (\d{1,2})\/(\d{1,2}) /, m => monthDay(now, +m[1] - 1, +m[2])],
    // weekdays: "thursday" is the next one (today counts), "next thursday" the one in the week after this
    [new RegExp(` (this |next |on |by )?(${DAYS.map(d => d.slice(0, 3) + "[a-z]*").join("|")}) `), m => {
      const target = DAYS.findIndex(d => d.startsWith(m[2].slice(0, 3)));
      let add = (target - now.getDay() + 7) % 7;
      // "next": the one in next week. If that day is still to come this week (Sunday to Saturday), skip it.
      if (m[1] === "next ") add = add === 0 ? 7 : now.getDay() + add <= 6 ? add + 7 : add;
      return addDays(now, add);
    }],
    // "the 21st", "on the 3rd"
    [/ (?:on |by )?the (\d{1,2})(?:st|nd|rd|th) /, m => nextDayOfMonth(now, +m[1])],
    [new RegExp(` (?:on |by )?the (${Object.keys(ORD).join("|")}) `), m => nextDayOfMonth(now, ORD[m[1]])]
  ];
  for (const [re, make] of tests) {
    const m = low.match(re);
    if (!m) continue;
    const d = make(m);
    if (d) return { date: d, span: m[0].trim() };
  }
  return null;
}

/** Everything in one go: what, when, and which course (matched by its name, or the start of it: "bio" for BIO 101). */
/** A time of day said in words: "at 3", "3:30 pm", "noon". Returns HH:MM and the words, or null. */
export function findTime(text: string): { time: string; span: string } | null {
  const low = ` ${text.toLowerCase().replace(/[,!?]/g, " ").replace(/\s+/g, " ")} `;
  const m = low.match(/ (?:at |@ ?)?(\d{1,2})(?::(\d\d))? ?(am|pm|a\.m\.|p\.m\.|a m|p m) /) || low.match(/ at (\d{1,2})(?::(\d\d))?( o'?clock)? /);
  if (m) {
    let h = +m[1]; const min = m[2] ? +m[2] : 0, ap = (m[3] || "").replace(/[ .]/g, "");
    if (h > 23 || min > 59) return null;
    if (ap === "pm" && h < 12) h += 12; else if (ap === "am" && h === 12) h = 0;
    else if (!ap || ap.includes("clock")) { if (h >= 1 && h <= 7) h += 12; } // "at 3" means the afternoon
    return { time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, span: m[0].trim() };
  }
  const n = low.match(/ (?:at )?(noon|midday|midnight) /);
  return n ? { time: n[1] === "midnight" ? "00:00" : "12:00", span: n[0].trim() } : null;
}
const KIND_WORDS: [Heard["kind"], RegExp][] = [
  ["exam", /\b(exam|midterm|final|quiz|test)\b/],
  ["study", /\b(study|review|revise|go over|cram)\b/],
  ["event", /\b(class|lecture|lab section|meeting|appointment|interview|practice|game|dentist|doctor|lunch|dinner|call with|office hours|seminar|club)\b/]
];

export function hear(said: string, courses: CourseLike[] = [], now = new Date()): Heard {
  const raw = said.trim().replace(/\s+/g, " ");
  const low0 = raw.toLowerCase();
  const repeat = /\b(every|each) (mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\bweekly\b/.test(low0) ? "weekly" as const : null;
  const kind = KIND_WORDS.find(([, re]) => re.test(low0))?.[0] || "deadline";
  const tm = findTime(raw);
  const found = findDate(raw, now);
  let rest = ` ${raw.toLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ")} `;
  if (found) rest = rest.replace(` ${found.span} `, " ");
  if (tm) rest = rest.replace(` ${tm.span} `, " ");
  rest = rest.replace(/ (?:every|each) /, " ").replace(/ weekly /, " ");
  // a time of day isn't kept (deadlines are days), but it shouldn't end up in the title either
  rest = rest.replace(/ (?:at |by )?(\d{1,2})(?::(\d\d))? ?(am|pm|a m|p m|o'?clock)? (?=(?:in|on|for|$| ))/g, (all, h, _m, ap) => (ap ? " " : all))
    .replace(/ (?:at |by )?(noon|midnight|\d{1,2}(?::\d\d)? ?(?:am|pm|a m|p m)) /g, " ");
  let courseId: string | null = null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const byLength = [...courses].sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const c of byLength) {
    const full = norm(c.name), first = full.split(" ")[0];
    // the whole name, the name run together ("bio101"), its first word, or the start of it ("chem" for Chemistry)
    const short = rest.trim().split(" ").find(w => w.length >= 3 && first.length > w.length && first.startsWith(w) && !/^(the|for|due|and)$/.test(w));
    const forms = [full, full.replace(/ (\d+)$/, "$1"), ...(first.length >= 3 ? [first] : []), ...(short ? [short] : [])];
    const hit = forms.find(f => f && new RegExp(` (?:for |in )?${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `).test(rest));
    if (hit) { courseId = c.id; rest = rest.replace(new RegExp(` (?:for |in )?${hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `), " "); break; }
  }
  let title = rest
    .replace(/^ *(?:hey |ok |okay )?(?:please )?(?:add|put|set|make|create|remind me(?: about| to| that)?|i have|there'?s|i've got|i got)( a| an| the)? /, " ")
    .replace(/ (?:to|on|in) (?:my|the) calendar /, " ")
    .replace(/ (?:is |are )?(?:due|happening|on|by|at|for)\s*$/, " ")
    .replace(/ (?:is |are )?due /, " ")
    .replace(/\s+/g, " ").trim();
  title = title.replace(/^(?:a|an|the|my) /, "").replace(/ (?:on|by|at|for|is|due)$/, "").trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return { title, date: found ? keyOf(found.date) : null, courseId, said: raw, kind, time: tm?.time || null, repeat };
}
