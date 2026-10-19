export function bronzePrefix(recordSource: string, batchId: string, dt = new Date()): string {
  const day = dt.toISOString().slice(0, 10);
  return `bronze/${recordSource}/dt=${day}/batch=${batchId}`;
}
