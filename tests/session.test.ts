import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isSessionReusable, recordLoginAttempt } from '../src/session';

describe('session lifecycle helpers', () => {
  let tmp: string;
  let original: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'windy-session-'));
    original = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmp;
    delete process.env.WINDY_DISABLE_LOGIN_THROTTLE;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = original;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('isSessionReusable: true only with non-stale token', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(isSessionReusable({ uid: 'u' })).toBe(false);
    expect(isSessionReusable({ uid: 'u', token: 't', tokenExp: future })).toBe(true);
    expect(isSessionReusable({ uid: 'u', token: 't', tokenExp: past })).toBe(false);
  });

  it('recordLoginAttempt is bypassable for tests', () => {
    process.env.WINDY_DISABLE_LOGIN_THROTTLE = '1';
    for (let i = 0; i < 20; i++) recordLoginAttempt();
  });

  it('recordLoginAttempt throws after exceeding the 24h window', () => {
    for (let i = 0; i < 8; i++) recordLoginAttempt();
    expect(() => recordLoginAttempt()).toThrow(/login throttle/);
  });
});
