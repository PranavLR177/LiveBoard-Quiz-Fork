import { subscribeClassPings, type ClassPing, classPreview, currentUser, sessionKnown, joinClass, leaderboard, leaveClass, myClasses, syncConfigured, type ClassPreview, type MyClass } from "./sync";

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
  leaderboard(id: string): Promise<{ display_name: string; points: number; is_me: boolean }[] | null>;
};

const server: ClassSource = { configured: syncConfigured, ready: () => Promise.race([sessionKnown, new Promise<void>(r => setTimeout(r, 5000))]), signedIn: () => !!currentUser(), myClasses, classPreview, joinClass, leaveClass, leaderboard, subscribe: subscribeClassPings };

function sample(): ClassSource {
  const list: MyClass[] = [
    { id: "demo-class-bio", name: "AP Biology", code: "BIO4KX", kind: "teacher", teacher: "Ms Rivera", students: 24, courseId: "demo-bio", shares: true, liveRoom: "DEMOLIVE", liveTitle: "Cellular respiration, part 2" },
    { id: "demo-class-calc", name: "Calc II study group", code: "CALC2G", kind: "study", teacher: "", students: 6, courseId: "demo-math", shares: false, liveRoom: null, liveTitle: null }
  ];
  const board = (me: number) => [["Priya", 42], ["Alex", me], ["Marcus", 31], ["Jo", 24], ["Sam", 12]].map(([n, p]) => ({ display_name: String(n), points: Number(p), is_me: n === "Alex" })).sort((a, b) => b.points - a.points);
  return {
    configured: () => true, ready: async () => {}, signedIn: () => true,
    myClasses: async () => list.map(c => ({ ...c })),
    classPreview: async code => ({ name: "Spanish II", kind: "teacher", teacher: "Sr. Ortiz", students: 18, code } as ClassPreview),
    joinClass: async (code, _d, courseId, share) => { const c: MyClass = { id: "demo-class-" + code, name: "Spanish II", code, kind: "teacher", teacher: "Sr. Ortiz", students: 19, courseId, shares: share, liveRoom: null, liveTitle: null }; list.push(c); return c; },
    leaveClass: async id => { const i = list.findIndex(c => c.id === id); if (i >= 0) list.splice(i, 1); },
    subscribe: () => () => {}, // the sample class is already live; nothing to push
    leaderboard: async id => board(id === "demo-class-bio" ? 38 : 9)
  };
}

export const classes: ClassSource = import.meta.env.VITE_ARTIFACT ? sample() : server;
