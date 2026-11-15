# Classroom in the LiveBoard app

The teacher home and classroom ship in the main Vite build at `/classroom.html`, with the notes side's top bar, colours and light/dark choice. Role switching, the teacher home, slide editing, and the student join screen use the same origin as notes. No ChatGPT-hosted URL is required.

## Local development

Use Node 22.13 or later. Install dependencies in both the root and `marker-slides/` with `npm ci`. Run the classroom API runtime from `marker-slides/` with `npm run dev -- --hostname 127.0.0.1` (port 5173). Run the root app with `npm run dev -- --host 127.0.0.1 --port 4180`. Open `http://127.0.0.1:4180/` for role selection, or `/classroom.html?view=library` for the teacher home. Root Vite proxies `/api/rooms` to port 5173; `CLASSROOM_API_PROXY` overrides that API address.

Live rooms need the local D1 schema from `marker-slides/drizzle/`, including `0003_student_marker_control.sql`. The permission migration defaults to allowing student markers and lets only a room host change that permission. The server rejects new student markers while paused, while existing markers remain available. The notes API can still use `API_PROXY` independently.

The teacher frontend is bundled with LiveBoard. In a deployed app (any build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set) live rooms use LiveBoard's own Supabase project through the `room_*` functions in `supabase/schema.sql`, so nothing needs to route `/api/rooms`. The D1 runtime described above is the fallback when Supabase isn't configured, which in practice means local development. Both back ends follow the same rules (`marker-slides/tests/rooms.mjs` for D1, `tests/sql/check.sql` for Supabase).

## Editing and data

Existing slides become editable text/image objects on read and save that layout after editing. Double-click text to type. Select and drag objects, use edge/corner handles to resize, and drag the centered rotation handle to rotate. Double-click images for crop mode; drag the image to pan, drag a handle to zoom, then choose Done cropping. Reset clears crop and rotation. Undo/redo groups continuous edits and keeps up to 50 history entries during the visit.

The library seeds two five-slide examples once. It does not clear existing users’ libraries. The requested local library replacement was performed separately with a recovery snapshot in the browser’s `liveboard-presentations` IndexedDB database (`libraryBackups` store). Existing decks without a recorded creation timestamp display that explicitly instead of inventing one.

The student join screen is accessible locally without an account login; joining a real room still requires its room code. Browser-local decks are device-local. Hosting and teacher capabilities are distinct from account roles.

## Validation

At the root: `npm run build` and `npm test` (which includes `tests/classroom.cjs`, a browser walk-through of the bundled classroom against a stand-in for the Supabase room functions). In `marker-slides/`: `npx tsc --noEmit`, `npm test`, and `npm run build`. Classroom tests cover permission enforcement, marker privacy, slide synchronization, object conversion, sample content structure, and undo/redo history. PostgreSQL checks in the root suite require a local PostgreSQL installation or CI’s database service.
