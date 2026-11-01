import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { type BatchMeta, batchMetaJson } from "../batch.js";
import type { R2Config } from "../config.js";
import { bronzePrefix } from "./paths.js";

export function createS3Client(cfg: R2Config): S3Client {
  return new S3Client({
    endpoint: cfg.endpointUrl,
    region: "auto",
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

export async function putBronzeJsonR2(
  cfg: R2Config,
  opts: {
    recordSource: string;
    batch: BatchMeta;
    payload: unknown;
    requestId: string;
  },
): Promise<string> {
  const { recordSource, batch, payload, requestId } = opts;
  const client = createS3Client(cfg);
  const prefix = bronzePrefix(recordSource, batch.batchId);
  const receivedAt = new Date().toISOString();
  const dataKey = `${prefix}/data/${receivedAt}_${requestId}.json`;
  const metaKey = `${prefix}/_meta/batch.json`;

  batch.recordSource = recordSource;
  batch.fileCount = 1;

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: dataKey,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: metaKey,
      Body: batchMetaJson(batch),
      ContentType: "application/json",
    }),
  );
  return prefix;
}
