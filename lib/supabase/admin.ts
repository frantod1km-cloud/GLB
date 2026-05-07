import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role - SOLO usar en server actions / API routes.
 * Bypasea Row Level Security. Nunca usar en componentes cliente.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
