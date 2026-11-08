export type BatchMeta = {
  batchId: string;
  recordSource: string;
  ingestedAt: string;
  fileCount: number;
  schemaVersion?: number;
  entity?: string;
};

export function newBatchMeta(batchId: string): BatchMeta {
  return {
    batchId,
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
      ...(batch.schemaVersion === undefined ? {} : { schema_version: batch.schemaVersion }),
      ...(batch.entity === undefined ? {} : { entity: batch.entity }),
    },
    null,
    2,
  );
}
