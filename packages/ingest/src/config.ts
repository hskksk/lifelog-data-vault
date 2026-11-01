export type R2Config = {
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type Settings = {
  databaseUrl: string;
  r2: R2Config | null;
  ingestBearerToken: string | null;
  personMapPath: string;
  bronzeLocalDir: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;

  let r2: R2Config | null = null;
  if (process.env.R2_BUCKET?.trim()) {
    r2 = {
      endpointUrl: requireEnv("R2_ENDPOINT"),
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: requireEnv("R2_BUCKET"),
    };
  }

  cached = {
    databaseUrl:
      process.env.DATABASE_URL?.trim() ??
      "postgresql://lifelog:lifelog@localhost:5432/lifelog",
    r2,
    ingestBearerToken: process.env.INGEST_BEARER_TOKEN?.trim() ?? null,
    personMapPath: process.env.PERSON_MAP_PATH?.trim() ?? "config/person_map.yml",
    bronzeLocalDir: process.env.BRONZE_LOCAL_DIR?.trim() ?? "var/bronze",
  };
  return cached;
}

export function resetSettingsCache(): void {
  cached = null;
}
