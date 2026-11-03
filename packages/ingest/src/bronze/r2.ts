import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { type BatchMeta, planBronzeJsonWrite } from "@lifelog/ingest-core";

import type { R2Config } from "../config.js";

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
  const client = createS3Client(cfg);
  const plan = planBronzeJsonWrite(opts);
  for (const obj of plan.objects) {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: obj.storageKey,
        Body: obj.body,
        ContentType: obj.contentType,
      }),
    );
  }
  return plan.bronzePrefix;
}
