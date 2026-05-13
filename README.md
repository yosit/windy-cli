# windy-cli

A CLI, Node library, and two agent integrations for the [windy.com](https://www.windy.com) API — forecasts, search, geo, stations, alerts, storms, webcams, tides, and authenticated user data.

This repo ships **three** surfaces over the same underlying client:

| Surface | Package | Path | Use it when… |
|---------|---------|------|--------------|
| **CLI + library** | `@yosit/windy-skill` | `src/`, `bin/` | You want the `windy` binary or to import `WindyClient` directly. |
| **Runline plugin** | `@yosit/runline-plugin-windy` | [`runline-plugin/`](./runline-plugin/) | You're building [runline](https://github.com/Michaelliv/runline) agents and want `windy.*` actions in your scripts. |
| **Dripline plugin** | `@yosit/dripline-plugin-windy` | [`dripline-plugin/`](./dripline-plugin/) | You want to query windy as SQL tables via [dripline](https://github.com/Michaelliv/dripline) / DuckDB. |

All three reuse the same `WindyClient`, so authentication, JWT refresh, and endpoint coverage stay in lock-step.

## Quick start (CLI)

```bash
pnpm install
pnpm build

# Anonymous works for most endpoints
node bin/windy-skill.js point 32.0853,34.7818 --model ecmwf
node bin/windy-skill.js storms list
node bin/windy-skill.js near 48.85,2.35           # nearby weather stations

# Auth via JWT or _account_sid cookie (see "Auth" below)
WINDY_TOKEN='eyJ...' node bin/windy-skill.js whoami
```

Install globally once it's published:

```bash
npm i -g @yosit/windy-skill
windy point 32.0853,34.7818
```

Output is [toon](https://github.com/toon-format/toon) by default; pass `--format json` for JSON.

### Common command groups

`windy <group> <sub>`:

- `point`, `now`, `meteogram`, `sounding`, `airq` — point forecasts
- `models`, `manifest`, `overlays`, `levels`, `basemaps`, `languages` — metadata
- `search`, `reverse`, `elevation`, `timezone` — geo / search
- `stations near|station|observations` — weather stations + history
- `poi at|near` — air-quality / tide POIs
- `webcams near|detail|archive|search` — webcams
- `alerts cap|live` — severe-weather alerts
- `storms list|count` — tropical cyclones
- `tides <lat,lon>`, `tides poi <id>` — tide forecasts
- `favourites`, `user alerts` — authenticated user data
- `login`, `refresh`, `whoami`, `session`, `logout` — auth

Run `windy --help` (or `windy <group> --help`) for the full list.

## Library use

```ts
import { WindyClient } from '@yosit/windy-skill';

const c = WindyClient.fromEnv();             // reads WINDY_TOKEN / WINDY_ACCOUNT_SID / WINDY_UID
const f = await c.pointForecast(32.0853, 34.7818, { model: 'ecmwf' });
console.log(f.data.temp[0] - 273.15, '°C now');
```

`WindyClient.fromEnv()` layers env vars on top of the persisted session at `~/.config/windy-cli/session.json` (mode 600). Pass `{ ephemeral: true, session: { token } }` to skip disk persistence — handy for plugins and short-lived agents.

## Auth

windy.com uses OAuth (Google / Facebook / Apple / email); there is no programmatic username/password endpoint. Two paths:

| Method | Env var | How to obtain | Lifetime |
|--------|---------|---------------|----------|
| Pre-issued JWT | `WINDY_TOKEN` | DevTools → Network → `account.windy.com/api/info` → copy `token2=…` from the URL | ~48 h |
| Cookie | `WINDY_ACCOUNT_SID` | DevTools → Application → Cookies → `_account_sid` | Long-lived; bootstraps a JWT on demand |

Most public endpoints (forecasts, search, geo, stations, alerts, storms, webcams, tides) work **anonymously** — no token needed. Auth unlocks: `whoami`, favourites, user alerts, live alerts, webcam archive, and premium-gated forecast refresh rates.

See [`skill.md`](./skill.md) for the full auth walkthrough.

## Runline plugin

Exposes the windy API as actions for agent scripts. Install into a runline workspace by URL:

```bash
runline plugin install git+https://github.com/yosit/windy-cli.git#path=runline-plugin
runline connection add windy \
  --config token=$WINDY_TOKEN \
  --config accountSid=$WINDY_ACCOUNT_SID
```

```javascript
// inside a runline agent script
const here     = await windy.geo.reverse({ lat: 32.0853, lon: 34.7818 });
const forecast = await windy.forecast.point({ lat: 32.0853, lon: 34.7818, model: 'ecmwf', setup: 'summary' });
const storms   = await windy.storms.list({});
```

Full action list and connection schema: [`runline-plugin/README.md`](./runline-plugin/README.md).

## Dripline plugin

Exposes the windy API as **SQL tables** (29 of them) backed by DuckDB. Install into a dripline workspace:

```bash
dripline plugin install git+https://github.com/yosit/windy-cli.git#path=dripline-plugin
dripline connection add windy \
  --config token=$WINDY_TOKEN \
  --config accountSid=$WINDY_ACCOUNT_SID
```

```sql
-- 5-day forecast for Tel Aviv at 6-hourly cadence
SELECT ts, temp_k - 273.15 AS temp_c, wind_ms, wind_dir_deg
FROM windy.windy_forecast_point
WHERE lat = 32.0853 AND lon = 34.7818 AND model = 'ecmwf' AND step = 6
ORDER BY ts;

-- Active tropical storms ranked by intensity
SELECT name, lat, lon, wind_speed_ms
FROM windy.windy_storms
ORDER BY wind_speed_ms DESC;
```

Time-series endpoints (forecast, AQ, sounding, observations, tides) emit long-format rows, so they join naturally with SQL.

Full table catalog and column reference: [`dripline-plugin/README.md`](./dripline-plugin/README.md).

## Repo layout

```
src/
  cli.ts          Commander program — every CLI subcommand
  client.ts       WindyClient — one method per endpoint
  session.ts      ~/.config/windy-cli/session.json persistence + JWT decode
  types.ts        Response shapes + model/overlay/level catalogs
  formatters.ts   toon (default) + json output
  index.ts        Public library exports
bin/
  windy-skill.js  shebang wrapper for the CLI
runline-plugin/   Runline plugin — windy.* actions
dripline-plugin/  Dripline plugin — windy_* SQL tables
kb/
  windy-api-architecture.md   Endpoints, auth, entity shapes, datetime conventions
  windy-api-intent.md         Per-endpoint Screen / Intent / Trigger
  windy-data-strategy.md      Caching notes
skills/           Claude Code skill bundles
tests/            vitest specs
skill.md          Skill front-matter + auth walkthrough
```

## Units (wire format)

Values are returned exactly as the windy API delivers them — consumers convert:

| Field | Unit |
|-------|------|
| Temperature | **Kelvin** |
| Wind speed | m/s |
| Wind direction | meteorological degrees (FROM direction) |
| Precipitation | mm per timestep |
| Pressure | hPa |
| Distance | km |
| Timestamps | unix ms UTC |

## Development

```bash
pnpm install
pnpm build          # tsc → dist/
pnpm test           # vitest
pnpm test:watch
pnpm lint           # tsc --noEmit
```

Plugin builds (each in their own subdir):

```bash
cd runline-plugin  && pnpm build
cd dripline-plugin && pnpm build
```

Both plugins type-map `@yosit/windy-skill` to the parent's built `dist/`, so run `pnpm build` at the root first.

## License

MIT
