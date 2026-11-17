import type { RoomsBackend } from "../../marker-slides/app/roomsApi";
import { classroomClient } from "./client";

/* Live classes on LiveBoard's own Supabase project (the room_* functions in supabase/schema.sql), so the deployed app
   needs no second server. Students join with the room code and don't need to sign in; the teacher's control is the
   room secret kept in their browser. A signed-in teacher's session goes along, which is how a room can be tied to one
   of their classes (room_for_class). */
export function supabaseRooms(): RoomsBackend | null {
  const sb = classroomClient();
  if (!sb) return null;
  const shots = new Map<string, string>(); // marker id -> its screenshot, fetched once
  const fail = (e: { message?: string } | null) => { if (e) throw new Error(e.message || "Could not reach the class. Please try again."); };
  return {
    canEnd: true,
    async get(id, who) {
      const { data, error } = await sb.rpc("room_get", { p_id: id, p_secret: who.secret || null, p_participant: who.participant || null, p_projector: !!who.projector });
      fail(error);
      const room = data as any;
      for (const m of room.markers) {
        if (m.has_screenshot && !who.projector) {
          if (shots.has(m.id)) m.screenshot = shots.get(m.id);
          else void sb.rpc("room_screenshot", { p_room: room.id, p_marker: m.id, p_secret: who.secret || null, p_participant: who.participant || null })
            .then(({ data: url }) => { if (typeof url === "string" && url.startsWith("data:image/jpeg;base64,")) shots.set(m.id, url); });
        }
        delete m.has_screenshot;
      }
      return room;
    },
    async post(room, data, who) {
      if (data.action === "create") {
        const r = await sb.rpc("room_create", { p_title: data.title, p_slides: data.slides, p_student_markers: data.studentMarkers !== false });
        fail(r.error);
        return r.data;
      }
      const { action, ...rest } = data;
      const r = await sb.rpc("room_act", { p_room: room, p_action: action, p_data: rest, p_secret: who.secret || null, p_participant: who.participant || null });
      fail(r.error);
      return r.data;
    }
  };
}
