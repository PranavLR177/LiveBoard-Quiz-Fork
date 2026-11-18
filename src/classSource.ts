import { myQuizzes, submitQuiz, type Quiz, subscribeClassPings, type ClassPing, classPreview, currentUser, sessionKnown, joinClass, leaderboard, leaveClass, myClasses, syncConfigured, type ClassPreview, type MyClass } from "./sync";

/* Where a student's classes come from: the server (src/sync.ts), or, in the single-file preview, which has no server,
   a few sample classes kept in memory so the Classes screen and the live-lesson notice can be tried out. */
export type ClassSource = {
  configured(): boolean;
  /** Settles once it's known whether someone is signed in (at most a few seconds after start-up). */
  ready(): Promise<void>;
  signedIn(): boolean;
  myClasses(): Promise<MyClass[] | null>;
  classPreview(code: string): Promise<ClassPreview | null>;
  joinClass(code: string, display: string, courseId: string | null, share: boolean): Promise<{ id: string; name: string; code: string; kind: string }>;
  leaveClass(id: string): Promise<void>;
  /** Pushed news of a class's live lesson starting or ending. Returns a function that stops listening. */
  subscribe(cb: (p: ClassPing) => void): () => void;
  myQuizzes(): Promise<Quiz[] | null>;
  submitQuiz(quizId: string, answers: { got: boolean; said: string; pick?: number }[]): Promise<{ score: number; total: number }>;
  leaderboard(id: string): Promise<{ display_name: string; points: number; is_me: boolean }[] | null>;
};

const server: ClassSource = { configured: syncConfigured, ready: () => Promise.race([sessionKnown, new Promise<void>(r => setTimeout(r, 5000))]), signedIn: () => !!currentUser(), myClasses, classPreview, joinClass, leaveClass, leaderboard, subscribe: subscribeClassPings, myQuizzes, submitQuiz };

function sample(): ClassSource {
  const list: MyClass[] = [
    { id: "demo-class-bio", name: "AP Biology", code: "BIO4KX", kind: "teacher", teacher: "Ms Rivera", students: 24, courseId: "demo-bio", shares: true, liveRoom: "DEMOLIVE", liveTitle: "Cellular respiration, part 2" },
    { id: "demo-class-calc", name: "Calc II study group", code: "CALC2G", kind: "study", teacher: "", students: 6, courseId: "demo-math", shares: false, liveRoom: null, liveTitle: null }
  ];
  const quizzes: Quiz[] = [{ id: "demo-quiz", classId: "demo-class-bio", className: "AP Biology", teacher: "Ms Rivera", title: "Cell respiration check", required: true,
    dueAt: Date.now() + 864e5, createdAt: Date.now() - 3600e3, done: false, score: null, total: null, shuffle: false,
    questions: [{ type: "short", q: "Where in the cell is most ATP made?", a: "In the mitochondria, by ATP synthase on the inner membrane" },
      { type: "choice", q: "What does the electron transport chain pump into the intermembrane space?", options: ["Electrons", "Protons", "Glucose", "Oxygen"], correct: 1, a: "Protons. Their flow back through ATP synthase makes ATP." },
      { type: "tf", q: "One glucose yields roughly 30 ATP.", options: ["True", "False"], correct: 0, a: "About 30 is the usual modern estimate (older books say 36–38)." }] }];
  const board = (me: number) => [["Priya", 42], ["Alex", me], ["Marcus", 31], ["Jo", 24], ["Sam", 12]].map(([n, p]) => ({ display_name: String(n), points: Number(p), is_me: n === "Alex" })).sort((a, b) => b.points - a.points);
  return {
    configured: () => true, ready: async () => {}, signedIn: () => true,
    myClasses: async () => list.map(c => ({ ...c })),
    classPreview: async code => ({ name: "Spanish II", kind: "teacher", teacher: "Sr. Ortiz", students: 18, code } as ClassPreview),
    joinClass: async (code, _d, courseId, share) => { const c: MyClass = { id: "demo-class-" + code, name: "Spanish II", code, kind: "teacher", teacher: "Sr. Ortiz", students: 19, courseId, shares: share, liveRoom: null, liveTitle: null }; list.push(c); return c; },
    leaveClass: async id => { const i = list.findIndex(c => c.id === id); if (i >= 0) list.splice(i, 1); },
    subscribe: () => () => {}, // the sample class is already live; nothing to push
    myQuizzes: async () => quizzes.map(q => ({ ...q })),
    submitQuiz: async (id, answers) => { const q = quizzes.find(x => x.id === id); const score = answers.filter((a, i) => { const it = q?.questions[i]; return it && it.type !== "short" ? a.pick === it.correct : a.got; }).length; if (q && !q.done) Object.assign(q, { done: true, score, total: answers.length }); return { score: q?.score ?? score, total: answers.length }; },
    leaderboard: async id => board(id === "demo-class-bio" ? 38 : 9)
  };
}

export const classes: ClassSource = import.meta.env.VITE_ARTIFACT ? sample() : server;
