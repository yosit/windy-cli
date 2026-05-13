import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { WindyJWT } from './types';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'windy-cli')
  : join(homedir(), '.config', 'windy-cli');

const SESSION_PATH = join(CONFIG_DIR, 'session.json');

export interface PersistedSession {
  /** `_account_sid` HttpOnly cookie value */
  accountSid?: string;
  /** Stable device UUID for the `uid` query param */
  uid: string;
  /** Cached JWT (refreshed when expired) */
  token?: string;
  /** Decoded `exp` claim, unix s */
  tokenExp?: number;
  /** User id from the last successful /api/info call */
  userId?: number;
  /** Username from the last successful /api/info call */
  username?: string;
  /** Subscription tier */
  subscription?: string;
}

export function decodeJWT(token: string): WindyJWT {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const payload = Buffer.from(parts[1], 'base64url').toString();
  return JSON.parse(payload) as WindyJWT;
}

export function loadSession(): PersistedSession {
  if (existsSync(SESSION_PATH)) {
    const raw = readFileSync(SESSION_PATH, 'utf8');
    return JSON.parse(raw) as PersistedSession;
  }
  return { uid: randomUUID() };
}

export function saveSession(s: PersistedSession): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SESSION_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function sessionPath(): string {
  return SESSION_PATH;
}

/** Returns true if token is missing or expires within `marginSec` seconds. */
export function tokenIsStale(s: PersistedSession, marginSec = 60): boolean {
  if (!s.token || !s.tokenExp) return true;
  return Date.now() / 1000 > s.tokenExp - marginSec;
}
