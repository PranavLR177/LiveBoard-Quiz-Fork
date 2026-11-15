import { createRoot } from "react-dom/client";
import Page from "./app/page";
import "./app/globals.css";
// The classroom is bundled into LiveBoard and shares its origin and local storage.
const params = new URLSearchParams(location.search);
if (!params.has("view") && !params.has("room") && !params.has("deck")) {
  params.set("view", "library");
  history.replaceState(null, "", location.pathname + "?" + params);
}
createRoot(document.getElementById("classroom-root")!).render(<Page />);
