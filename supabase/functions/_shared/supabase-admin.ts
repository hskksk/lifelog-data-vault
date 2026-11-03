import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase secret API key (`sb_secret_...`), not legacy service_role JWT.
 * @see https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
 */
export function defaultSecretKey(): string {
  const direct = Deno.env.get("SUPABASE_SECRET_KEY")?.trim();
  if (direct) return direct;

  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY or SUPABASE_SECRET_KEYS (hosted Edge injects the latter).",
    );
  }
  const keys = JSON.parse(raw) as Record<string, string>;
  const key = keys["default"];
  if (!key) throw new Error('SUPABASE_SECRET_KEYS must include a "default" secret key.');
  return key;
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("Missing SUPABASE_URL");
  return createClient(url, defaultSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Cron / pg_net must send secret key on `apikey` header (not Authorization Bearer). */
export function authorizeMaterializeRequest(headers: {
  apikey?: string | null;
  authorization?: string | null;
}): boolean {
  let secret: string;
  try {
    secret = defaultSecretKey();
  } catch {
    return false;
  }
  if (headers.apikey && timingSafeEqual(headers.apikey, secret)) return true;

  const materializeToken = Deno.env.get("MATERIALIZE_BEARER_TOKEN");
  const auth = headers.authorization;
  if (materializeToken && auth === `Bearer ${materializeToken}`) return true;
  return false;
}
