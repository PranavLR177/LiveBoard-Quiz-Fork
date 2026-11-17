import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* The classroom page's Supabase client. It shares the notes side's sign-in (same origin, same stored session), so a
   teacher signed in on LiveBoard is signed in here too; supabase-js coordinates token refresh between the two pages.
   Students joining a live lesson don't need to be signed in: without a session the calls go out with the public key. */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
let client: SupabaseClient | null | undefined;
export function classroomClient(): SupabaseClient | null {
  if (client === undefined) client = URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
  return client;
}
