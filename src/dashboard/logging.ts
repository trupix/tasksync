export function timedLog(label: string, startMs: number, extra?: Record<string, unknown>): void {
  const durationMs = Date.now() - startMs;
  const entry: Record<string, unknown> = {
    op: label,
    durationMs,
    ts: new Date().toISOString(),
  };
  if (extra) Object.assign(entry, extra);
  console.log(JSON.stringify(entry));
}
