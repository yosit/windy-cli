---
name: windy
description: CLI and library for windy.com. Covers point forecasts (ECMWF, GFS, ICON, etc.), search, reverse-geocoding, elevation, tides, tropical storms, CAP alerts, nearby weather stations + air quality stations + webcams, station observation timeseries, and user data (favourites, alerts, settings) when authenticated.
---

# windy skill

CLI + library for windy.com. Most endpoints work anonymously; log in to unlock favourites, user-defined alerts, and premium-gated forecasts.

## Session

Session lives in `~/.config/windy-cli/session.json` (mode 600).

### Authenticating

windy.com uses OAuth (Google/Facebook/Apple/email) — there is no programmable username/password endpoint. Two ways to authenticate:

**Option A — paste the JWT from a logged-in browser**

1. Open `https://www.windy.com` and sign in (any provider).
2. Open DevTools → Network tab → reload the page → find a request to `account.windy.com/api/info`.
3. Look at the request URL — there is a `token2=eyJ...` query parameter. Copy that value.
4. `WINDY_TOKEN='eyJ...' windy whoami` (or set it once via env var).

The JWT is good for ~48 h. Re-paste when it expires.

**Option B — paste the `_account_sid` cookie (longer-lived)**

1. Sign in via browser.
2. DevTools → Application → Cookies → `https://account.windy.com` → copy the `_account_sid` value.
3. `windy login --cookie <_account_sid>`

With the cookie set, the CLI auto-refreshes the JWT on every invocation.

### Anonymous

Forecasts, search, reverse, elevation, webcams, storms, alerts, stations, air quality, tides — all work without a session. Only `favs`, `alerts user`, and `settings` require a logged-in session.

## Commands

### Forecast
| Command | What it returns |
|---------|-----------------|
| `windy forecast point <lat,lon> [-m MODEL] [--setup full] [--extended]` | Multi-day point forecast |
| `windy forecast now <lat,lon> [-m MODEL]` | Current-conditions snapshot |
| `windy forecast meteogram <lat,lon> [-m MODEL]` | Hourly multi-parameter timeseries |
| `windy forecast airq <lat,lon> [-m cams\|camsEu]` | Air-quality forecast |
| `windy forecast manifest [MODEL]` | Model availability / reftimes |
| `windy forecast models [--scope --domain --keys-only]` | Model catalog with premium uplift, filterable |
| `windy forecast sounding <lat,lon> [-m MODEL --at HOUR]` | Pressure-level sounding (skew-T) — 17 levels × 6 params |

Models: `ecmwf`, `gfs`, `icon`, `iconEu`, `iconD2`, `mblue`, `namConus`, `namHawaii`, `namAlaska`, `arome*`, `canHrdps`, `canRdwpsWaves`, `czeAladin`, `hrrr*`, `bomAccess*`, `ukv`, `jmaMsm`, `jmaCwmWaves`, `iconEuWaves`, `ecmwfWaves`. Premium subscribers unlock high-res regional models and the extended 15-day window (`--extended`).

### Location
| Command | What it returns |
|---------|-----------------|
| `windy search <query> --near <lat,lon> [--size N]` | Location search biased to a coordinate. `N` must be ≥ 10. Mixed result types: city, suburb, state, webcam. |
| `windy reverse <lat,lon> [--zoom N]` | Reverse geocode. zoom 14 ≈ neighborhood, 10 ≈ city. |
| `windy elevation <lat,lon>` | Elevation in meters (bare number) |
| `windy timezone <lat,lon> [--ts MS]` | Timezone info for a coordinate |

### Weather stations / observations
| Command | What it returns |
|---------|-----------------|
| `windy stations near <lat,lon>` | Nearby airport METAR + WMO + PWS + MADIS stations with latest report |
| `windy stations observations <type> <id> [--days N --step H]` | Historical observations timeseries. `type` ∈ `ad`, `wmo`, `pws`, `madis`, `airq`. `id` without prefix. |

### Air quality
| Command | What it returns |
|---------|-----------------|
| `windy airq near <lat,lon>` | Nearby air-quality stations (OpenAQ-backed) |
| `windy airq station <id>` | Air-quality station detail with PM2.5, PM10, AQI, CO, NO2, O3, SO2 |

### Tides
| Command | What it returns |
|---------|-----------------|
| `windy tides at <lat,lon>` | Tide forecast for nearest port |
| `windy tides near <lat,lon>` | Nearby tide stations |

### Alerts
| Command | What it returns |
|---------|-----------------|
| `windy alerts cap <lat,lon> [--max N]` | Government-issued CAP severe weather alerts |
| `windy alerts live <lat,lon> [--distance km\|mi]` | Live alerts feed for current user |
| `windy alerts user` | List user-defined alerts (requires login) |

### Tropical cyclones
| Command | What it returns |
|---------|-----------------|
| `windy storms list` | Active worldwide tropical storms with positions |
| `windy storms count` | Number of active storms |

### Webcams
| Command | What it returns |
|---------|-----------------|
| `windy webcams near <lat,lon> [--limit N --size thumbnail\|preview\|original]` | Webcams near coordinate with image URLs |
| `windy webcams detail <id>` | Webcam detail |
| `windy webcams archive <id>` | Webcam archive frame list |

### Radar / satellite
| Command | What it returns |
|---------|-----------------|
| `windy radar info` | Radar composite metadata |
| `windy radar coverage` | Radar coverage polygon |
| `windy radar satellite` | Satellite composite metadata |
| `windy radar archive` | Radar archive frame range |
| `windy radar satellite-archive` | Satellite archive frame range |
| `windy radar image-url <radar\|satellite> <lat,lon> [-w 640 -h 360]` | URL to pre-rendered widget image |
| `windy static-map <lat,lon> [--zoom 10 --size 640]` | URL to static map image |
| `windy tile data <model> <run> <hour> <overlay> <z> <x> <y> [--ext jpg\|png]` | Pre-rendered weather data tile URL on ims.windy.com |
| `windy tile basemap <style> <z> <x> <y>` | Basemap tile URL |
| `windy tile labels <z> <x> <y> [--lang]` | Place-label tile URL |

### Reference data (no API call)
| Command | What it returns |
|---------|-----------------|
| `windy overlays` | All 66 renderable weather overlays |
| `windy levels` | 17 atmospheric levels with altitude/flight level |
| `windy basemaps` | Supported basemap styles |
| `windy languages` | Supported UI / label languages |

### Webcam owner CRUD (requires login)
| Command | What it returns |
|---------|-----------------|
| `windy webcams mine` | List webcams you own |
| `windy webcams search <q> [--near]` | Text-search all webcams |
| `windy webcams ping <id>` | Webcam health metrics |
| `windy webcams register --title --at --image-url [--source-url --description]` | Register a new webcam |
| `windy webcams remove <id>` | Delete an owned webcam |

### Push notifications (requires login)
| Command | What it returns |
|---------|-----------------|
| `windy push register <token> [--platform web\|ios\|android]` | Register an FCM/APNs push token |
| `windy push unregister` | Remove this device |

### api.windy.com (commercial API, separate API key required)
| Command | What it returns |
|---------|-----------------|
| `windy api point <lat,lon> -m MODEL -p wind,temp,rh [--levels surface,850h] [--key KEY]` | Call the official Point Forecast API — uses `WINDY_API_KEY` env var |

### User data (require login)
| Command | What it returns |
|---------|-----------------|
| `windy favs list` | Saved favourite locations |
| `windy favs delete <key>` | Delete a favourite |
| `windy settings` | User UI / locale / units / home location |

### Session
| Command | What it returns |
|---------|-----------------|
| `windy login --cookie <_account_sid>` | Store cookie + bootstrap JWT |
| `windy logout` | Clear stored session |
| `windy whoami` | Refresh JWT and show user / subscription info |
| `windy session` | Show session file path, decoded token claims |
| `windy refresh [--token-only \| --env \| --quiet]` | Cron-friendly: mint a fresh JWT from the cookie and persist it |
| `windy token [--margin SECONDS \| --no-refresh]` | Print current JWT (refreshes if stale) — for `export WINDY_TOKEN=$(windy token)` |

## Keeping the JWT fresh from cron / an agent

The JWT lives ~48 h; the `_account_sid` cookie lives months. To keep an agent permanently authenticated:

**One-time setup** — set the durable cookie credential as an env var (use psst, AWS Secrets, k8s secret, or similar — never commit it):
```bash
export WINDY_ACCOUNT_SID='s%3AckP2NEUYmbDiEGmf...'
```

**Periodic refresh** — schedule any of these patterns:

```bash
# Cron every 6 hours: refresh JWT, log success/failure
0 */6 * * *  /usr/local/bin/windy refresh --quiet || logger -t windy "refresh failed"

# Or write the env-var file your agent sources before each run
0 */6 * * *  /usr/local/bin/windy refresh --env > ~/.config/windy-cli/env

# In your agent process, just call this before each request — auto-refreshes if stale
export WINDY_TOKEN=$(WINDY_ACCOUNT_SID=$SID windy token --margin 3600)
```

`windy refresh` writes the new JWT to `~/.config/windy-cli/session.json`. Any other invocation of `windy <command>` automatically uses the stored JWT. If the server rotates the `_account_sid` cookie on the response, the new cookie value is also persisted.

Exit codes: `0` on success, `1` on any failure (expired cookie, network error, etc.) — safe for `|| alert` patterns.

## Output

- `--format json` (default) — machine-readable JSON
- `--format toon` — compact human-readable [toon](https://github.com/toon-format/toon)

## Environment

| Var | Purpose |
|-----|---------|
| `WINDY_ACCOUNT_SID` | `_account_sid` cookie value (**durable**, lasts months — set this for cron) |
| `WINDY_TOKEN` | Pre-issued JWT (**short-lived**, ~48 h — use for one-off invocations) |
| `WINDY_UID` | Override the device UUID |
| `WINDY_API_KEY` | Separate api.windy.com key (only for `windy api ...` commands) |
| `WINDY_HTTP_TIMEOUT` | HTTP request timeout in ms (default 30000) |
| `XDG_CONFIG_HOME` | Overrides config dir (defaults to `~/.config`) |

Precedence: env vars override the session file. Setting `WINDY_ACCOUNT_SID` (alone) is the recommended pattern — the CLI will mint and cache a JWT as needed.

## Units (response wire format)

| Field | Unit |
|-------|------|
| Temperature | **Kelvin** (subtract 273.15 for °C) |
| Wind speed | m/s |
| Wind direction | meteorological degrees (FROM direction) |
| Precipitation | mm per timestep |
| Pressure | hPa |
| Distance (station results) | km |
| Timestamps | unix milliseconds (UTC) |
| Sunset/sunrise strings (`celestial.sunset`) | local "HH:mm" |
| ISO strings ending in `Z` | UTC |

## Quirks

- Forecasts return Kelvin and m/s — convert on the consumer side.
- `summary.tempMax/Min` are the **daily** Kelvin extremes, not the timeseries max/min.
- `pr=0` in URLs doesn't mean "not premium" — it's a derived flag the SPA computes from current subscription state plus the active page kind.
- Some endpoints return `204 No Content` for empty results (CAP alerts, promotions) — the CLI shows `null`.
- The default search `size` must be ≥ 10 (server enforces).
