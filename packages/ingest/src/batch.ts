import { randomUUID } from "node:crypto";

export type BatchMeta = {
  batchId: string;
  recordSource: string;
  ingestedAt: string;
  fileCount: number;
};

export function newBatchMeta(): BatchMeta {
  return {
    batchId: randomUUID(),
    recordSource: "",
    ingestedAt: new Date().toISOString(),
    fileCount: 0,
  };
}

export function batchMetaJson(batch: BatchMeta): string {
  return JSON.stringify(
    {
      batch_id: batch.batchId,
      record_source: batch.recordSource,
      ingested_at: batch.ingestedAt,
      file_count: batch.fileCount,
    },
    null,
    2,
  );
}
