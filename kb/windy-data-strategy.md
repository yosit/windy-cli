---
title: Windy Data Extraction Strategy
tags: [windy, api, data, sync, export, duckdb]
---

# Windy Data Extraction Strategy

How to get data out of windy.com for offline analysis and cross-system joins.

---

## Shape of the data

Windy is fundamentally a **real-time forecast service**, not a transactional
database. There is no concept of a "history table" or "all my orders." Three
classes of data exist:

| Class | Examples | Cacheable? | Sync strategy |
|-------|----------|------------|---------------|
| **Forecast** | point forecast, sounding, meteogram, AQ forecast, tides | Yes, but expires when next model run lands (3–12 h depending on model) | Time-windowed snapshot keyed by `(lat, lon, model, ref_time)` |
| **Observed** | station observations, METAR, AQ stations, webcams | Yes — append-only by `(station_id, ts)` | Incremental tail by `ts` |
| **Reference / catalog** | available models, manifest, reverse-geocode, elevation, timezone | Yes — slow-changing | Daily full refresh; (lat, lon)-keyed cache |
| **User** | favourites, user alerts, account | Yes — small | Daily full refresh per user |
| **Live event** | active tropical storms, CAP alerts, user live alerts | Volatile | Pull on demand; archive snapshot per `synced_at` |

There is **no bulk export endpoint** — windy serves one query at a time.
Extraction is "fanout small queries, store snapshots."

---

## Bulk Export Endpoints

| Endpoint | Method | Format | Row Limit | Notes |
|----------|--------|--------|-----------|-------|
| _(none)_ | — | — | — | Windy has no list/export endpoint. All bulk extraction is fanout of point queries. |

The closest things to "bulk" are:
- `/forecast/<model>/point/...` returns the **entire timeseries** for one
  (lat, lon) in a single call — typically 240–384 hourly steps.
- `/observations/<type>/<id>` returns up to **30 days** of history in one call
  (`days` ∈ {1, 3, 7, 10, 30}).
- `/stations` near (lat, lon) returns up to ~50 nearest stations with their
  latest obs in one call.

So the unit of extraction is the point-query response, not a row.

## Response Format Decoding

All endpoints return JSON. No base64, no protobuf, no XLSX. Encodings to
handle on the wire:

| Encoding | Detection | Decoding |
|----------|-----------|----------|
| `gzip` | `content-encoding: gzip` | `zlib.createGunzip` |
| `br` | `content-encoding: br` | `zlib.createBrotliDecompress` |
| `deflate` | `content-encoding: deflate` | `zlib.createInflate` |
| `zstd` | `content-encoding: zstd` | `zlib.createZstdDecompress` (Node ≥ 22.15) |

`204 No Content` is returned for some endpoints (e.g. CAP alerts with no
active alerts); client surfaces this as `null`, not an error.

## Pagination Strategies

| Domain | Strategy | Params | Notes |
|--------|----------|--------|-------|
| Forecast | None — single shot | `step`, `ref_time` | Full timeseries in one response. Choose `step` for resolution, not pagination. |
| Observations | Time window | `days`, `step` | `days` ∈ {1, 3, 7, 10, 30}; longer windows trade resolution for coverage. |
| Stations near | Distance-capped | — | Server returns ~top 50 by distance. No `offset`. |
| Webcams near | `limit` | `limit` | Hard cap server-side (~30). |
| Search / reverse | `size` | `size` (default 13) | No paging beyond `size`. |
| CAP alerts | `max_count` | `maxCount` | Soft cap. |
| Storms | None | — | All active storms in one call (always < 50). |

No cursor or offset paging anywhere. For wider coverage, fan out across
locations or time windows client-side.

## Sync Approach per Domain

| Domain | Strategy | Frequency | Key Field | Notes |
|--------|----------|-----------|-----------|-------|
| `forecast_point` | Snapshot per model run | After each `ref_time` (every 3–12 h depending on model) | `(lat, lon, model, ref_time)` | Don't dedupe across timesteps — re-pull on new ref_time. |
| `forecast_summary` | Same as above | Same | Same | Derived from setup=summary call. |
| `forecast_sounding` / `meteogram` | Snapshot per run | On demand | `(lat, lon, model, ref_time)` | Heavy payloads — cache 1 ref_time deep. |
| `forecast_air_quality` | Snapshot per run | Every 12 h | `(lat, lon, model, ref_time)` | CAMS / camsEu. |
| `station_observations` | Incremental tail | Hourly (or per `step`) | `(station_type, station_id, ts)` | Append rows where `ts > MAX(ts)`. |
| `stations_nearby*` | Slow-changing dimension | Daily | `(query_lat, query_lon, id)` | Cache by query point; row identity is the station `id`. |
| `storms` | Snapshot | Every 30–60 min during season | `(synced_at, id)` | History valuable — keep all snapshots. |
| `alerts_cap` | Snapshot | Every 15–30 min in active areas | `(synced_at, id)` | Same — snapshots, not upserts. |
| `geo_reverse` / `geo_elevation` / `geo_timezone` | Permanent cache | Once per coord | `(lat, lon)` | Effectively immutable at 14-digit precision. |
| `forecast_models` | Daily | Daily | `(model, premium)` | Manifest changes as new runs publish. |
| `favourites`, `user_alerts`, `account_info` | Full refresh | Per CLI invocation | `id` | Small lists; don't bother with deltas. |
| `webcams_*` | Slow-changing dimension | Weekly | `(id)` | Camera roster shifts slowly; `current` image URLs change continuously. |

## Data Availability Matrix

| Entity | JSON API | CSV/Excel | Date Range | Multi-tenant |
|--------|----------|-----------|------------|--------------|
| Point forecast | ✓ | ✗ | Forward 10–15 d | No |
| Sounding | ✓ | ✗ | Forward ~3 d (ecmwf), 7 d (gfs) | No |
| AQ forecast | ✓ | ✗ | Forward 5 d (cams) | No |
| Tides | ✓ | ✗ | Forward 30 d | No |
| Station obs | ✓ | ✗ | Back up to 30 d | No |
| Storms | ✓ | ✗ | Live only | No |
| CAP alerts | ✓ | ✗ | Live only | No |
| Favourites | ✓ | ✗ | Live | Yes — per `accountSid` |
| User alerts | ✓ | ✗ | Live | Yes — per `accountSid` |

Nothing is org-scoped; "tenancy" here means the signed-in user's own data.

## DuckDB Schema

Snapshot-oriented. Every table carries `synced_at` so successive ETL runs
can be deduped or windowed. Forecast tables key on `(lat, lon, model,
ref_time, ts_ms)` so multiple model runs can coexist for comparison.

```sql
-- Forecast snapshots — one row per (location, model, ref_time, timestep).
CREATE TABLE IF NOT EXISTS windy_forecast_point (
  lat              DOUBLE NOT NULL,
  lon              DOUBLE NOT NULL,
  model            VARCHAR NOT NULL,
  ref_time         TIMESTAMP NOT NULL,
  ts_ms            BIGINT NOT NULL,
  ts               TIMESTAMP,
  temp_k           DOUBLE,
  wind_ms          DOUBLE,
  wind_u_ms        DOUBLE,
  wind_v_ms        DOUBLE,
  wind_dir_deg     DOUBLE,
  gust_ms          DOUBLE,
  rh_pct           DOUBLE,
  pressure_hpa     DOUBLE,
  precip_mm        DOUBLE,
  snow_mm          DOUBLE,
  cape             DOUBLE,
  ptype            INTEGER,
  synced_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lat, lon, model, ref_time, ts_ms)
);

-- Station observations — append-only by station + timestamp.
CREATE TABLE IF NOT EXISTS windy_station_observations (
  station_type     VARCHAR NOT NULL,   -- airq | ad | wmo | pws | madis
  station_id       VARCHAR NOT NULL,
  ts_ms            BIGINT NOT NULL,
  ts               TIMESTAMP,
  temp_c           DOUBLE,
  wind_ms          DOUBLE,
  gust_ms          DOUBLE,
  dir_deg          DOUBLE,
  pressure_hpa     DOUBLE,
  rh_pct           DOUBLE,
  precip           DOUBLE,
  aqi              DOUBLE,
  raw              JSON,
  synced_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (station_type, station_id, ts_ms)
);

-- Storms — snapshot table; each sync is a new generation.
CREATE TABLE IF NOT EXISTS windy_storms_snapshots (
  synced_at        TIMESTAMP NOT NULL,
  id               VARCHAR NOT NULL,
  name             VARCHAR,
  lat              DOUBLE,
  lon              DOUBLE,
  strength         INTEGER,
  wind_speed_ms    DOUBLE,
  PRIMARY KEY (synced_at, id)
);

-- CAP alerts — snapshot per query coord per sync.
CREATE TABLE IF NOT EXISTS windy_alerts_cap_snapshots (
  synced_at        TIMESTAMP NOT NULL,
  query_lat        DOUBLE NOT NULL,
  query_lon        DOUBLE NOT NULL,
  id               VARCHAR NOT NULL,
  sender           VARCHAR,
  sent             TIMESTAMP,
  event            VARCHAR,
  severity         VARCHAR,
  urgency          VARCHAR,
  effective        TIMESTAMP,
  expires          TIMESTAMP,
  headline         VARCHAR,
  description      VARCHAR,
  PRIMARY KEY (synced_at, query_lat, query_lon, id)
);

-- Reverse-geocode / elevation / timezone — slow-changing per coord.
CREATE TABLE IF NOT EXISTS windy_geo_cache (
  lat              DOUBLE NOT NULL,
  lon              DOUBLE NOT NULL,
  zoom             INTEGER,
  city             VARCHAR,
  state            VARCHAR,
  country          VARCHAR,
  country_code     VARCHAR,
  elevation_m      DOUBLE,
  tz_name          VARCHAR,
  tz_offset_min    INTEGER,
  synced_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lat, lon)
);
```

For sounding / meteogram, mirror `windy_forecast_point` with `level` added
to the primary key.

## Sync State Tracking

A small control table per domain keeps incremental syncs resumable.

```sql
CREATE TABLE IF NOT EXISTS windy_sync_state (
  domain           VARCHAR PRIMARY KEY,  -- e.g. 'forecast_point:48.85,2.35:ecmwf'
  last_ref_time    TIMESTAMP,            -- for forecast snapshots
  last_ts_ms       BIGINT,               -- for incremental obs tail
  last_synced_at   TIMESTAMP,
  row_count        BIGINT,
  status           VARCHAR               -- ok | partial | error
);
```

| Entity | Resume key | What to track |
|--------|-----------|---------------|
| Forecast | `(lat, lon, model)` | `last_ref_time` — skip re-pull if model hasn't issued a new run. |
| Station obs | `(station_type, station_id)` | `last_ts_ms` — request `days` covering the gap. |
| Storms / alerts | none | Always pull; snapshot history. |
| Geo cache | per coord | Present-or-absent — no resume. |

## Operational notes

- **Rate / throttle.** Anonymous and authenticated tiers both tolerate
  bursts but penalize sustained fanout. Cap to ~5 RPS per IP and add jitter.
  Use `WINDY_PROXY` to route through a debugging proxy if Cloudflare
  challenges appear.
- **Cold-start cost.** A fresh `_account_sid` bootstrap is one `/api/info`
  round-trip; the JWT is then valid ~48 h. The client persists at
  `~/.config/windy-cli/session.json` and refuses to re-bootstrap more than
  8 times per 24 h (`recordLoginAttempt`).
- **Backfill.** For station history, walk `days=30` calls forward at the
  resolution you need. Forecast history is **not available** — windy only
  serves the most recent run plus a small archive of recent runs via
  explicit `ref_time`.
