import { createRoot } from "react-dom/client";
import Page from "./app/page";
import "./app/globals.css";
import { initTheme, isDark, onTheme } from "../src/theme";
import { supabaseRooms } from "../src/classroom/rooms";
import { setRoomsBackend } from "./app/roomsApi";
import { setClassesBackend } from "./app/classesApi";
import { supabaseClasses } from "../src/classroom/classes";
import { installDevSwitch } from "../src/devSwitch";

// The classroom is bundled into LiveBoard: it shares the notes side's origin, storage, light/dark choice and server.
// LiveBoard leaves data-theme unset when following the device; the classroom's stylesheet wants it spelled out.
const spellOut = () => { document.documentElement.dataset.theme = isDark() ? "dark" : "light"; };
onTheme(spellOut);
initTheme();
const live = supabaseRooms();
if (live) setRoomsBackend(live);
// otherwise /api/rooms, the stand-alone classroom runtime used in local development
setClassesBackend(supabaseClasses()); // a teacher's classes need LiveBoard's accounts; without them the Classes screen says so

const params = new URLSearchParams(location.search);
if (!params.has("view") && !params.has("room") && !params.has("deck")) {
  params.set("view", "library");
  history.replaceState(null, "", location.pathname + "?" + params);
}
installDevSwitch(); // development only: remove before launch (see src/devSwitch.ts)
createRoot(document.getElementById("classroom-root")!).render(<Page />);
