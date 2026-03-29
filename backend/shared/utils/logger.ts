export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err?: unknown, data?: Record<string, unknown>): void;
}

/**
 * Creates a structured JSON logger bound to a specific Lambda invocation.
 * Output is written to stdout/stderr so CloudWatch Logs picks it up automatically.
 *
 * Each log line is a single JSON object compatible with CloudWatch Logs Insights:
 *   { level, timestamp, fn, requestId, userId?, msg, ...data }
 */
export function createLogger(fn: string, requestId: string, userId?: string): Logger {
  const base: Record<string, unknown> = { fn, requestId };
  if (userId) base.userId = userId;

  return {
    info(msg: string, data?: Record<string, unknown>) {
      console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), ...base, msg, ...data }));
    },
    warn(msg: string, data?: Record<string, unknown>) {
      console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), ...base, msg, ...data }));
    },
    error(msg: string, err?: unknown, data?: Record<string, unknown>) {
      const errInfo: Record<string, unknown> =
        err instanceof Error
          ? { errorMessage: err.message, errorStack: err.stack }
          : err !== undefined
          ? { errorRaw: String(err) }
          : {};
      console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), ...base, msg, ...errInfo, ...data }));
    },
  };
}
