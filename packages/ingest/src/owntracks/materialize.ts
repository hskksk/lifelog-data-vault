import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

import { createS3Client } from "../bronze/r2.js";
import { getSettings } from "../config.js";
import {
  createPool,
  insertOwntracksInbox,
  listBatchesToMaterialize,
  markBatchStaged,
} from "../db.js";
import { resolvePersonId } from "../person-map.js";
import { parseLocationPayload, type OwnTracksPayload } from "./parse.js";

async function streamToString(body: unknown): Promise<string> {
  if (!body || typeof body !== "object" || !("transformToString" in body)) {
    throw new Error("Unexpected S3 body");
  }
  return (body as { transformToString: () => Promise<string> }).transformToString();
}

function listBronzeDataFilesLocal(bronzePrefix: string, root: string): string[] {
  const base = join(root, bronzePrefix, "data");
  try {
    return readdirSync(base)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(base, f));
  } catch {
    return [];
  }
}

async function listBronzeDataKeysR2(
  bronzePrefix: string,
): Promise<{ key: string; fileName: string }[]> {
  const settings = getSettings();
  if (!settings.r2) return [];
  const client = createS3Client(settings.r2);
  const prefix = `${bronzePrefix}/data/`;
  const out: { key: string; fileName: string }[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: settings.r2.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) {
        out.push({ key: obj.Key, fileName: obj.Key.split("/").pop() ?? obj.Key });
      }
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function fetchR2Json(key: string): Promise<OwnTracksPayload> {
  const settings = getSettings();
  if (!settings.r2) throw new Error("R2 not configured");
  const client = createS3Client(settings.r2);
  const resp = await client.send(
    new GetObjectCommand({ Bucket: settings.r2.bucket, Key: key }),
  );
  const text = await streamToString(resp.Body);
  return JSON.parse(text) as OwnTracksPayload;
}

function receivedAtFromFileName(fileName: string): string {
  const base = fileName.replace(/\.json$/, "");
  const idx = base.lastIndexOf("_");
  return idx > 0 ? base.slice(0, idx) : base;
}

async function processPayload(
  pool: ReturnType<typeof createPool>,
  opts: {
    batchId: string;
    bronzeKey: string;
    receivedAt: string;
    payload: OwnTracksPayload;
    mapPath: string;
  },
): Promise<boolean> {
  const { payload } = opts;
  if (payload._type !== "location") return false;
  const topic = String(payload.topic ?? "owntracks/unknown/phone");
  const personId = resolvePersonId(topic, opts.mapPath);
  const row = parseLocationPayload(payload, personId);
  return insertOwntracksInbox(pool, {
    batchId: opts.batchId,
    bronzeKey: opts.bronzeKey,
    receivedAt: opts.receivedAt,
    row,
  });
}

export async function materializeOwntracks(): Promise<number> {
  const settings = getSettings();
  const pool = createPool(settings.databaseUrl);
  let loaded = 0;

  try {
    const batches = await listBatchesToMaterialize(pool, "owntracks");
    for (const { batchId, bronzePrefix } of batches) {
      if (settings.r2) {
        for (const { key, fileName } of await listBronzeDataKeysR2(bronzePrefix)) {
          const payload = await fetchR2Json(key);
          if (
            await processPayload(pool, {
              batchId,
              bronzeKey: key,
              receivedAt: receivedAtFromFileName(fileName),
              payload,
              mapPath: settings.personMapPath,
            })
          ) {
            loaded += 1;
          }
        }
      } else {
        for (const path of listBronzeDataFilesLocal(bronzePrefix, settings.bronzeLocalDir)) {
          const payload = JSON.parse(readFileSync(path, "utf8")) as OwnTracksPayload;
          const fileName = path.split("/").pop() ?? path;
          if (
            await processPayload(pool, {
              batchId,
              bronzeKey: path,
              receivedAt: receivedAtFromFileName(fileName),
              payload,
              mapPath: settings.personMapPath,
            })
          ) {
            loaded += 1;
          }
        }
      }
      await markBatchStaged(pool, batchId);
    }
  } finally {
    await pool.end();
  }
  return loaded;
}
