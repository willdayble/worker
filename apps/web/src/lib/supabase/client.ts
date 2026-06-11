import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Singleton browser client — one per session. Multiple clients cause auth-lock
// contention ("Lock was released because another request stole it"). Uses the
// PUBLISHABLE (anon) key only; every read/write is RLS-scoped to auth.uid().
// The service key and WORKER_MASTER_KEY are SERVER-ONLY and never reach here
// (CONTRACTS §5).
let browserClient: SupabaseClient | undefined;

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return browserClient;
}
