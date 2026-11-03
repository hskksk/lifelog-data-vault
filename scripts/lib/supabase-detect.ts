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
      console.log(`Auto-detected project: ${projects[0].name} (${projects[0].id})`);
      return projects[0].id;
    }
    if (projects.length > 1) {
      const linked = projects.find((p) => p.linked);
      if (linked) {
        console.log(`Auto-detected linked project: ${linked.name} (${linked.id})`);
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
