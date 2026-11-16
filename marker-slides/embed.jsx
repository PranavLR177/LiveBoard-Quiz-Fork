import { createRoot } from "react-dom/client";
import Page from "./app/page";
import css from "./app/globals.css?inline";
import { embed } from "./app/nav";

/* The classroom mounted inside the notes page instead of on its own page. Only the single-file preview uses this (it
   can't hold a second page); the real app serves the classroom at /classroom.html (client.tsx). The stylesheet is
   added only while the classroom is showing, because both sides style the page as a whole. Types: embed.d.ts. */
let root = null, el = null, style = null, key = 0;

export function openClassroom(search, toNotes) {
  closeClassroom();
  style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  el = document.createElement("div"); el.id = "classroom-root"; document.body.appendChild(el);
  root = createRoot(el);
  const render = () => root && root.render(<Page key={++key} />); // a new key starts the screen fresh, as a page load would
  embed({ toNotes, rerender: render }, search);
  render();
}

export function closeClassroom() {
  if (root) root.unmount();
  if (el) el.remove();
  if (style) style.remove();
  root = el = style = null;
  embed(null, "");
}
