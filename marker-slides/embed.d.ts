/** Mounts the classroom inside the current page at the given screen (e.g. "?view=library"). See embed.jsx. */
export function openClassroom(search: string, toNotes: (as?: "individual" | "student" | "teacher", hash?: string) => void): void;
export function closeClassroom(): void;
