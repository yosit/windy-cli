# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A CLI tool and Node.js client for the windy.com API, built as a Claude Code skill.
The CLI lets Claude (and humans) interact with windy.com as if using the web app.

## Tech Stack

- **Runtime**: Node.js ≥16, TypeScript, pnpm
- **CLI framework**: commander
- **Output format**: toon (default, `@toon-format/toon`) + JSON (`--format json`)
- **Tests**: vitest
- **Build**: `tsc`

## Commands

```bash
pnpm install        # install deps
pnpm build          # compile TypeScript → dist/
pnpm test           # run all tests
pnpm test:watch     # watch mode
pnpm lint           # tsc --noEmit
```

## Credentials

windy.com uses OAuth (Google/Facebook/Apple/email). There is no programmatic username/password endpoint, so the CLI authenticates by reusing a logged-in browser's `_account_sid` cookie OR by accepting a pre-issued JWT (`token2` query param value).

Env vars the client reads:
- `WINDY_TOKEN` — pre-issued JWT, bypasses the cookie bootstrap
- `WINDY_ACCOUNT_SID` — value of the `_account_sid` HttpOnly cookie
- `WINDY_UID` — override the device UUID
- `WINDY_HTTP_TIMEOUT` — HTTP timeout in ms (default 30000)

Session persists at `~/.config/windy-cli/session.json` (mode 600). Anonymous mode (no auth) works for most public endpoints (forecasts, search, reverse, elevation, webcams, stations, air quality, storms, alerts, tides).

## Windy API

- **Website**: https://www.windy.com
- **Account / auth**: `https://account.windy.com/api/info` — bootstraps JWT from `_account_sid` cookie
- **Main API base**: `https://node.windy.com`
- **Auth type**: HttpOnly cookie session → HS256 JWT, ~48 h lifetime, passed as `token2=` query or `Authorization: Bearer`
- **Full spec**: `../windy-kb/.napkin/specs/windy-api-architecture.md`
- **Intent doc**: `../windy-kb/.napkin/specs/windy-api-intent.md`

## Project Structure

```
src/
  cli.ts        # Commander program; ~30 subcommands grouped by resource
  client.ts     # WindyClient — one method per endpoint; https only
  session.ts    # ~/.config/windy-cli/session.json persistence + JWT decode
  types.ts      # TypeScript interfaces for all response shapes
  formatters.ts # toon (default) + json output
  index.ts      # Public API exports
bin/
  windy-skill.js  # shebang wrapper
```

## Architecture

### Client class

`WindyClient.fromEnv()` reads env overrides (`WINDY_TOKEN`, `WINDY_ACCOUNT_SID`, `WINDY_UID`) layered on top of the persisted session at `~/.config/windy-cli/session.json`. All API calls are instance methods.

`ensureAuth()` runs only when a `_account_sid` cookie is set and the cached JWT expires within 60 s — it then calls `refreshAuth()` to mint a fresh JWT. If only a JWT was supplied without a cookie, `refreshAuth()` is skipped (we have no way to re-mint without the cookie).

`refreshAuth()` is careful to **only persist a fresh JWT when the `/api/info` response shows `auth: true`** — otherwise it would clobber the user-supplied authenticated token with an anonymous one.

All requests go through `request()` which:
1. Calls `ensureAuth()` (unless `auth: false` is passed).
2. Sets the standard envelope (`token2`, `uid`, `v`, `poc`, `pr`, `sc`) on `node.windy.com` requests.
3. Sets the `_account_sid` cookie if available, plus the bundle-fingerprint `accept` header.
4. Decodes `content-encoding` (gzip / brotli / inflate / zstd if Node ≥ 22.15).
5. Returns parsed JSON, or `null` for `204 No Content`, or the raw text for `options.raw`.

Path obfuscation note: the SPA sometimes wraps forecast paths in base64 (`/Zm9yZWNhc3Q/ZWNtd2Y/cG9pbnQv...`), but the clean equivalent (`/forecast/point/ecmwf/v2.9/{lat}/{lon}?...`) returns identical JSON. The CLI uses the clean form.

### CLI pattern

`buildProgram()` in `cli.ts` returns the Commander program. Each command calls `withClient(c => c.someMethod(...))` and prints the result via `out()`. Global `--format`, `--lang`, `--country`, `--timeout` flags are set in the `preAction` hook.

### Output

- Default: `formatToon(data)` → compact tabular layout
- `--format json`: `JSON.stringify(data, null, 2)`
- Errors: `error: <msg>` on stderr, exit 1

## Knowledge Base

Windy API discoveries are documented in `../windy-kb/.napkin/specs/`:
- `windy-api-architecture.md` — endpoints, auth, entity shapes, datetime conventions
- `windy-api-intent.md` — per-endpoint Screen / Intent / Trigger
- `windy-data-strategy.md` — caching strategy (stub)

Update the napkin before committing — it is the source of truth for the next session.

## Units (wire format)

| Field | Unit |
|-------|------|
| Temperature | **Kelvin** |
| Wind speed | m/s |
| Wind direction | meteorological degrees (FROM direction) |
| Precipitation | mm per timestep |
| Pressure | hPa |
| Distance | km |
| Timestamps | unix ms (UTC) |

The CLI returns values exactly as the API does — consumers convert.
