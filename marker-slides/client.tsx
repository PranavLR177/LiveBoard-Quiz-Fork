import { createRoot } from "react-dom/client";
import Page from "./app/page";
import "./app/globals.css";
import { initTheme, isDark, onTheme } from "../src/theme";
import { supabaseRooms } from "../src/classroom/rooms";
import { setRoomsBackend } from "./app/roomsApi";

// The classroom is bundled into LiveBoard: it shares the notes side's origin, storage, light/dark choice and server.
// LiveBoard leaves data-theme unset when following the device; the classroom's stylesheet wants it spelled out.
const spellOut = () => { document.documentElement.dataset.theme = isDark() ? "dark" : "light"; };
onTheme(spellOut);
initTheme();
const live = supabaseRooms();
if (live) setRoomsBackend(live); // otherwise /api/rooms, the stand-alone classroom runtime used in local development

const params = new URLSearchParams(location.search);
if (!params.has("view") && !params.has("room") && !params.has("deck")) {
  params.set("view", "library");
  history.replaceState(null, "", location.pathname + "?" + params);
}
createRoot(document.getElementById("classroom-root")!).render(<Page />);
