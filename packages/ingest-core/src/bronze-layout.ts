import { type BatchMeta, batchMetaJson } from "./batch";
import { bronzePrefix } from "./paths";

/** Supabase Storage bucket id is `bronze`; object path omits that prefix. */
export function bronzeStorageObjectPath(storageKey: string): string {
  return storageKey.startsWith("bronze/") ? storageKey.slice("bronze/".length) : storageKey;
}

export type BronzeObject = {
  /** Logical key (matches R2); use bronzeStorageObjectPath for Supabase bucket `bronze`. */
  storageKey: string;
  body: string;
  contentType: string;
};

export type BronzeWritePlan = {
  bronzePrefix: string;
  batch: BatchMeta;
  objects: BronzeObject[];
};

export function planBronzeJsonWrite(opts: {
  recordSource: string;
  batch: BatchMeta;
  payload: unknown;
  requestId: string;
  receivedAt?: string;
}): BronzeWritePlan {
  const { recordSource, batch, payload, requestId } = opts;
  const receivedAt = opts.receivedAt ?? new Date().toISOString();
  const prefix = bronzePrefix(recordSource, batch.batchId, new Date(receivedAt));
  batch.recordSource = recordSource;
  batch.fileCount = 1;

  const dataKey = `${prefix}/data/${receivedAt}_${requestId}.json`;
  const metaKey = `${prefix}/_meta/batch.json`;

  return {
    bronzePrefix: prefix,
    batch,
    objects: [
      {
        storageKey: dataKey,
        body: JSON.stringify(payload),
        contentType: "application/json",
      },
      {
        storageKey: metaKey,
        body: batchMetaJson(batch),
        contentType: "application/json",
      },
    ],
  };
}
