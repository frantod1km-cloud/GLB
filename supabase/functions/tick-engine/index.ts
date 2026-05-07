// ============================================================================
// GOLBIT - Edge Function: tick-engine
// ============================================================================
// Esta función se invoca desde un cron externo (cron-job.org) cada N segundos.
// Llama a la RPC public_tick que ejecuta el motor de precios para todas las
// monedas activas.
//
// Setup:
//   1. Subir esta función con `supabase functions deploy tick-engine` o via UI
//   2. Setear secrets: SUPABASE_URL, SUPABASE_ANON_KEY, ENGINE_SECRET
//   3. Configurar cron-job.org para que invoque la URL de esta función cada 10s
//
// Headers que el cron externo debe mandar:
//   GET https://<proyecto>.supabase.co/functions/v1/tick-engine
//   Authorization: Bearer <anon_key>
//   X-Engine-Secret: <engine_secret>
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-engine-secret",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const engineSecret = Deno.env.get("ENGINE_SECRET");

    if (!engineSecret) {
      return jsonResponse({ error: "ENGINE_SECRET not configured" }, 500);
    }

    // Verificar header de seguridad
    const providedSecret = req.headers.get("X-Engine-Secret");
    if (providedSecret !== engineSecret) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Crear cliente Supabase y llamar la RPC
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.rpc("public_tick", {
      p_secret: engineSecret,
    });

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse(data);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
