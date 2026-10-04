'use strict';

/**
 * Minimal structured logger. Deliberately dependency-free for Phase 2.
 * Every message passes through `redact()` so credentials embedded in
 * connection strings can never reach the logs.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/** Replaces `user:password@` in any URI-like substring with `***:***@`. */
function redact(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+)(:[^/\s@]*)?@/gi, '$1***:***@');
}

function currentLevel() {
  if (process.env.LOG_LEVEL && LEVELS[process.env.LOG_LEVEL] !== undefined) return LEVELS[process.env.LOG_LEVEL];
  return process.env.NODE_ENV === 'test' ? LEVELS.error : LEVELS.info;
}

function log(level, message, meta) {
  if (LEVELS[level] > currentLevel()) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: redact(String(message)),
  };
  if (meta !== undefined) {
    entry.meta = meta instanceof Error ? { name: meta.name, message: redact(meta.message) } : JSON.parse(redact(JSON.stringify(meta)));
  }
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
  redact,
};
