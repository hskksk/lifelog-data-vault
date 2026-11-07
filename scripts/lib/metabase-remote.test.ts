import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DbtPostgresConnection } from "./dbt-connection.ts";
import { REMOTE_MART_DATABASE_NAME } from "./bi-connection.ts";
import {
  describeFetchError,
  normalizeMetabaseUrl,
  redactSecret,
  resolveMetabaseAuth,
  upsertRemoteDatabase,
  waitForMetabase,
} from "./metabase-remote.ts";

const conn: DbtPostgresConnection = {
  host: "aws-0-ap-northeast-1.pooler.supabase.com",
  port: 5432,
  user: "bi_reader.abcdefghijklmnop",
  password: "p@ss/word+",
  dbname: "postgres",
  sslmode: "require",
};

const headers = { "content-type": "application/json", "x-api-key": "mb_test" };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(raw);
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(async (req, res) => {
    try {
      handler(req, res, await readBody(req));
    } catch (err) {
      res.writeHead(500);
      res.end(err instanceof Error ? err.message : String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function connectionDetails(body: string, nested: boolean): Record<string, unknown> {
  const parsed = JSON.parse(body) as {
    engine?: string;
    details: Record<string, unknown> | { engine: string; details: Record<string, unknown> };
  };
  if (nested) {
    const wrapped = parsed.details as { engine: string; details: Record<string, unknown> };
    assert.equal(wrapped.engine, "postgres");
    return wrapped.details;
  }
  assert.equal(parsed.engine, "postgres");
  return parsed.details as Record<string, unknown>;
}

function assertConnection(details: Record<string, unknown>) {
  assert.equal(details.host, conn.host);
  assert.equal(details.port, 5432);
  assert.equal(details.user, conn.user);
  assert.equal(details.password, conn.password);
  assert.equal(details.ssl, true);
  assert.equal(details["ssl-mode"], "require");
  assert.equal(details["schema-filters-patterns"], "mart");
}

function assertPayload(body: string) {
  assertConnection(connectionDetails(body, false));
}

function assertValidateBody(body: string) {
  assertConnection(connectionDetails(body, true));
}

async function main() {
await withServer(
  (req, res, body) => {
    if (req.url === "/api/database/validate" && req.method === "POST") {
      assertValidateBody(body);
      send(res, 200, { valid: true });
      return;
    }
    if (req.url === "/api/database" && req.method === "GET") {
      send(res, 200, { data: [] });
      return;
    }
    if (req.url === "/api/database" && req.method === "POST") {
      const parsed = JSON.parse(body) as { name: string };
      assert.equal(parsed.name, REMOTE_MART_DATABASE_NAME);
      assertPayload(body);
      send(res, 200, { id: 4, name: parsed.name });
      return;
    }
    send(res, 404, { error: req.method + " " + req.url });
  },
  async (baseUrl) => {
    const result = await upsertRemoteDatabase(baseUrl, headers, conn);
    assert.equal(result, "created");
  },
);

let synced = false;
await withServer(
  (req, res, body) => {
    if (req.url === "/api/database/validate") {
      send(res, 200, { valid: true });
      return;
    }
    if (req.url === "/api/database" && req.method === "GET") {
      send(res, 200, { data: [{ id: 4, name: REMOTE_MART_DATABASE_NAME }] });
      return;
    }
    if (req.url === "/api/database/4" && req.method === "PUT") {
      assertPayload(body);
      send(res, 200, { id: 4 });
      return;
    }
    if (req.url === "/api/database/4/sync_schema" && req.method === "POST") {
      synced = true;
      send(res, 200, { status: "ok" });
      return;
    }
    send(res, 404, { error: req.method + " " + req.url });
  },
  async (baseUrl) => {
    const result = await upsertRemoteDatabase(baseUrl, headers, conn);
    assert.equal(result, "updated");
  },
);
assert.equal(synced, true);

await withServer(
  (req, res) => {
    send(res, 401, "Unauthenticated");
  },
  async (baseUrl) => {
    await assert.rejects(
      () => upsertRemoteDatabase(baseUrl, headers, conn),
      (err: unknown) => {
        assert.match(String(err), /Metabase rejected the API login \(401\)/);
        assert.equal(/bi_reader login/.test(String(err)), false);
        return true;
      },
    );
  },
);

await withServer(
  (req, res) => {
    send(res, 400, { message: `password ${conn.password} rejected` });
  },
  async (baseUrl) => {
    await assert.rejects(
      () => upsertRemoteDatabase(baseUrl, headers, conn),
      (err: unknown) => {
        assert.match(String(err), /bi_reader login \(400\)/);
        assert.match(String(err), /\*\*\*/);
        assert.equal(String(err).includes(conn.password), false);
        return true;
      },
    );
  },
);

assert.equal(redactSecret("keep", ""), "keep");
assert.equal(normalizeMetabaseUrl("http://localhost:3000"), "http://127.0.0.1:3000");
assert.equal(normalizeMetabaseUrl("http://127.0.0.1:3001/"), "http://127.0.0.1:3001");
assert.equal(normalizeMetabaseUrl("http://[::1]:3000/"), "http://127.0.0.1:3000");

const refused = new TypeError("fetch failed");
refused.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), { code: "ECONNREFUSED" });
assert.match(describeFetchError(refused), /ECONNREFUSED/);

let healthCalls = 0;
await waitForMetabase("http://127.0.0.1:3000", {
  timeoutMs: 10_000,
  intervalMs: 1,
  now: () => 0,
  sleep: async () => {},
  log: () => {},
  fetchImpl: (async () => {
    healthCalls += 1;
    if (healthCalls < 2) throw refused;
    return new Response("ok", { status: 200 });
  }) as typeof fetch,
});
assert.equal(healthCalls, 2);

await assert.rejects(
  () => waitForMetabase("http://127.0.0.1:3000", {
    timeoutMs: 0,
    intervalMs: 1,
    now: () => 0,
    sleep: async () => {},
    log: () => {},
    fetchImpl: (async () => {
      throw refused;
    }) as typeof fetch,
  }),
  /did not become ready/,
);

await withServer(
  (req, res) => {
    if (req.url === "/api/user/current") {
      const key = req.headers["x-api-key"];
      if (key === "mb_good") {
        send(res, 200, { is_superuser: true });
        return;
      }
      send(res, 401, "Unauthenticated");
      return;
    }
    send(res, 404, {});
  },
  async (baseUrl) => {
    const headers = await resolveMetabaseAuth(baseUrl, { apiKey: "mb_good" }, { log: () => {} });
    assert.equal(headers["x-api-key"], "mb_good");
    await assert.rejects(
      () => resolveMetabaseAuth(baseUrl, { apiKey: "not-a-key" }, { log: () => {} }),
      /does not start with mb_/,
    );
  },
);

let fellBack = false;
await withServer(
  (req, res, body) => {
    if (req.url === "/api/user/current" && req.headers["x-api-key"]) {
      send(res, 401, "Unauthenticated");
      return;
    }
    if (req.url === "/api/session" && req.method === "POST") {
      const parsed = JSON.parse(body) as { username: string };
      assert.equal(parsed.username, "admin@example.com");
      send(res, 200, { id: "11111111-1111-1111-1111-111111111111" });
      return;
    }
    if (req.url === "/api/user/current" && req.headers["x-metabase-session"]) {
      fellBack = true;
      send(res, 200, { is_superuser: true });
      return;
    }
    send(res, 404, {});
  },
  async (baseUrl) => {
    const headers = await resolveMetabaseAuth(
      baseUrl,
      { apiKey: "mb_stale", email: "admin@example.com", password: "secret1" },
      { log: () => {} },
    );
    assert.equal(headers["X-Metabase-Session"], "11111111-1111-1111-1111-111111111111");
  },
);
assert.equal(fellBack, true);

console.log("metabase-remote.test.ts ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
