import { createClient } from "@supabase/supabase-js";

// Public client. The publishable/anon key is safe to expose — access is
// governed by Row Level Security policies on the database.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: false },
      // supabase-js calls `fetch` under the hood; Next caches GETs by default.
      // Force no-store so reads always reflect the live database.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    })
  : null;
