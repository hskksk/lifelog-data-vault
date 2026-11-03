import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function createServiceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cron / internal callers use service_role; optional MATERIALIZE_BEARER_TOKEN for a dedicated secret. */
export function authorizeInternalRequest(authHeader: string | undefined): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const materializeToken = Deno.env.get("MATERIALIZE_BEARER_TOKEN");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  if (serviceKey && token === serviceKey) return true;
  if (materializeToken && token === materializeToken) return true;
  return false;
}
