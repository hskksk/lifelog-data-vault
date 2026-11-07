import { execSync } from "node:child_process";

export function detectProjectRef(): string {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const out = execSync("supabase projects list -o json", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const projects: Array<{ id: string; name: string; linked?: boolean }> = JSON.parse(out);
    if (projects.length === 1) {
      console.error(`Auto-detected project: ${projects[0].name} (${projects[0].id})`);
      return projects[0].id;
    }
    if (projects.length > 1) {
      const linked = projects.find((p) => p.linked);
      if (linked) {
        console.error(`Auto-detected linked project: ${linked.name} (${linked.id})`);
        return linked.id;
      }
      console.error(
        "Multiple Supabase projects found. Set SUPABASE_PROJECT_REF to the target project id:\n" +
          projects.map((p) => `  ${p.id}  ${p.name}`).join("\n"),
      );
      process.exit(1);
    }
  } catch {
    // not logged in or CLI unavailable
  }
  console.error(
    "SUPABASE_PROJECT_REF is unset and could not be resolved via supabase projects list.",
  );
  process.exit(1);
}

/** Secret API key (`sb_secret_...`) for Vault upsert + materialize Cron (not legacy service_role JWT). */
export function detectSecretKey(projectRef: string): string {
  if (process.env.SUPABASE_SECRET_KEY?.trim()) return process.env.SUPABASE_SECRET_KEY.trim();
  try {
    const out = execSync(
      `supabase projects api-keys --project-ref ${projectRef} -o json`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const keys: Array<{ name: string; api_key: string; type?: string }> = JSON.parse(out);
    const byName = keys.find((k) => k.name === "default" || k.name === "secret");
    if (byName?.api_key) {
      console.error(`Auto-detected secret key (${byName.name}) from supabase projects api-keys.`);
      return byName.api_key;
    }
    const byType = keys.find((k) => k.type === "secret");
    if (byType?.api_key) {
      console.error("Auto-detected secret key from supabase projects api-keys.");
      return byType.api_key;
    }
  } catch {
    // CLI unavailable or PAT lacks scope
  }
  console.error(
    "SUPABASE_SECRET_KEY is unset and could not be resolved via supabase projects api-keys.",
  );
  process.exit(1);
}
