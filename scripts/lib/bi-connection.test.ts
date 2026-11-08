import assert from "node:assert/strict";
import {
  REMOTE_MART_DATABASE_NAME,
  biReaderConnectionFromPostgresPooler,
  metabaseRemoteDatabasePayload,
} from "./bi-connection.ts";

const pooler =
  "postgresql://postgres.abcdefghijklmnop:secret%40pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require";

const conn = biReaderConnectionFromPostgresPooler(
  "abcdefghijklmnop",
  pooler,
  "p@ss/word+",
);

assert.equal(conn.host, "aws-0-ap-northeast-1.pooler.supabase.com");
assert.equal(conn.port, 5432);
assert.equal(conn.user, "bi_reader.abcdefghijklmnop");
assert.equal(conn.password, "p@ss/word+");
assert.equal(conn.dbname, "postgres");
assert.equal(conn.sslmode, "require");

const payload = metabaseRemoteDatabasePayload(conn);
assert.equal(payload.name, REMOTE_MART_DATABASE_NAME);
assert.equal(payload.engine, "postgres");
assert.equal(payload.details.host, conn.host);
assert.equal(payload.details.port, 5432);
assert.equal(payload.details.user, conn.user);
assert.equal(payload.details.password, "p@ss/word+");
assert.equal(payload.details.ssl, true);
assert.equal(payload.details["ssl-mode"], "require");
assert.equal(payload.details["schema-filters-type"], "inclusion");
assert.equal(payload.details["schema-filters-patterns"], "mart,business_vault");
assert.equal(payload.details["tunnel-enabled"], false);

console.log("bi-connection.test.ts ok");
