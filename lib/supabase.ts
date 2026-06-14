import { createClient } from "@supabase/supabase-js";

// Public client. The publishable/anon key is safe to expose — access is
// governed by Row Level Security policies on the database.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

const noStoreFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, cache: "no-store" });

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: false },
      // supabase-js calls `fetch` under the hood; Next caches GETs by default.
      // Force no-store so reads always reflect the live database.
      global: { fetch: noStoreFetch },
    })
  : null;

// Server-only admin client (service role). Bypasses RLS, so it is only ever
// used by trusted server actions that have already validated/verified input —
// e.g. persisting a real launch with a mint/treasury_wallet, which the locked-
// down anon insert policy forbids. The key has no NEXT_PUBLIC_ prefix and must
// never be imported into a Client Component. Null when unset (prototype mode).
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: noStoreFetch },
      })
    : null;
