import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { fetchConMayusculas } from "./fetch-mayusculas";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
  // Mayúsculas solo cuando hace falta en nombres y artículos (lib/supabase/fetch-mayusculas.ts).
  global: { fetch: fetchConMayusculas() },
});
