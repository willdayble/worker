import 'server-only';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

// SERVER-ONLY service-role client (bypasses RLS). Use ONLY in trusted server jobs
// (e.g. the seed script, future server-side maintenance) — NEVER in a request
// handler driven by user input, and NEVER in the browser (CONTRACTS §5). The
// `server-only` import makes a client-bundle import a build error.
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('service client needs SUPABASE_URL + SUPABASE_SECRET_KEY (server-only).');
  }
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}
