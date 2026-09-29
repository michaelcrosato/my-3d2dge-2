/** Buffers console warnings/errors and uncaught exceptions so agents can read them (`logs`). */
export interface LogEntry {
  t: number;
  level: 'error' | 'warn' | 'info';
  message: string;
}

export const logBuffer: LogEntry[] = [];
let seq = 0;

function push(level: LogEntry['level'], args: unknown[]) {
  const message = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a)))
    .join(' ');
  logBuffer.push({ t: ++seq, level, message: message.slice(0, 2000) });
  if (logBuffer.length > 300) logBuffer.splice(0, logBuffer.length - 300);
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function installLogCapture() {
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      orig(...args);
    };
  }
  window.addEventListener('error', (e) => push('error', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => push('error', ['unhandled rejection:', e.reason]));
}

export function logInfo(message: string) {
  push('info', [message]);
}
