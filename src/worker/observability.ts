export type ObservabilityBindings = {
  OBSERVABILITY?: AnalyticsEngineDataset;
  APP_ENV?: string;
};

export type TraceContext = {
  traceId: string;
  spanId: string;
  traceparent: string;
};

type LogLevel = "info" | "warn" | "error";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function traceContext(request: Request): TraceContext {
  const incoming = request.headers.get("traceparent")?.match(TRACEPARENT);
  const traceId = incoming?.[1].toLowerCase() ?? randomHex(16);
  const spanId = randomHex(8);
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

export function logEvent(
  level: LogLevel,
  event: string,
  trace: TraceContext,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    traceId: trace.traceId,
    spanId: trace.spanId,
    ...fields,
  };
  console.log(JSON.stringify(entry));
}

export function recordMetric(
  env: ObservabilityBindings,
  metric: string,
  trace: TraceContext,
  value = 1,
  fields: string[] = [],
): void {
  env.OBSERVABILITY?.writeDataPoint({
    blobs: [metric, env.APP_ENV ?? "unknown", ...fields],
    doubles: [value],
    indexes: [metric],
  });
}

export function elapsedMilliseconds(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}
