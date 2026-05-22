/**
 * `@yosit/dripline-plugin-windy` — windy.com as SQL tables (DuckDB).
 *
 * What this is: a dripline plugin that exposes the windy.com API as ~30
 * read-only SQL tables. Use when the user asks about weather forecasts,
 * marine conditions, air quality, severe-weather alerts, tropical storms,
 * tides, METAR/airport info, weather stations, or webcams — anywhere SQL
 * is more ergonomic than a sequence of CLI calls.
 *
 * Auth (all optional — most tables work anonymously):
 *   - `WINDY_ACCOUNT_SID` (recommended) — `_account_sid` cookie value;
 *     long-lived; auto-refreshes a JWT on demand. Required for
 *     `windy_account*`, `windy_favourites`, `windy_user_alerts*`,
 *     `windy_alerts_live`.
 *   - `WINDY_TOKEN` — pre-issued JWT (`token2`), ~48 h, no refresh.
 *   - `WINDY_PROXY` — HTTPS proxy URL for debugging.
 *
 * Top tables to know:
 *   - `windy_forecast_point` — hourly forecast time-series (long format).
 *   - `windy_forecast_summary` — daily aggregates (max/min temp, dominant wind).
 *   - `windy_storms` — currently-active tropical cyclones.
 *   - `windy_alerts_cap` — government-issued severe-weather alerts.
 *   - `windy_stations_nearby` — METAR / WMO / PWS / MADIS stations near a point.
 *   - `windy_tides` — tide heights for the nearest port (or by tide-POI id).
 *
 * Units stay on the wire — temperature in Kelvin (`*_k`), wind in m/s (`*_ms`),
 * pressure in hPa (`*_hpa`), distance in km (`*_km`), timestamps in unix ms
 * (`*_ms`). Time-series tables also expose an ISO `ts` column for joins.
 */
import type { DriplinePluginAPI, QueryContext, Qual } from "dripline";
import { randomUUID } from "crypto";
import {
  WindyClient,
  WindyAPIError,
  type ClientOptions,
  type PersistedSession,
  type PointForecast,
  type SearchResponse,
  type ReverseGeocode,
  type NearbyWeatherStation,
  type NearbyAirQualityStation,
  type AirQualityPOI,
  type ObservationTimeseries,
  type TideForecast,
  type CapAlert,
  type StormsResponse,
  type WebcamList,
  type Webcam,
  type AirportResponse,
  type AccountInfo,
  type Favourite,
  type FavouriteValue,
  type UserAlertItem,
  type Sounding,
} from "@yosit/windy-skill";

// ── Qual helpers ──────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  if (typeof v === "number") return v !== 0;
  return undefined;
}

function qVal(quals: Qual[], col: string): unknown {
  return quals.find((q) => q.column === col && q.operator === "=")?.value;
}
function qStr(q: Qual[], c: string): string | undefined { return str(qVal(q, c)); }
function qNum(q: Qual[], c: string): number | undefined { return num(qVal(q, c)); }
function qBool(q: Qual[], c: string): boolean | undefined { return bool(qVal(q, c)); }

// ── Client construction ───────────────────────────────────────────────────

function getClient(ctx: QueryContext): WindyClient {
  const cfg = ctx.connection?.config ?? {};
  const token = str(cfg.token);
  const accountSid = str(cfg.accountSid);
  const proxy = str(cfg.proxy);
  if (proxy && !process.env.WINDY_PROXY) process.env.WINDY_PROXY = proxy;
  const uid = str(cfg.uid) ?? randomUUID();
  const session: PersistedSession = { uid };
  if (token) session.token = token;
  if (accountSid) session.accountSid = accountSid;
  const opts: ClientOptions = {
    session,
    ephemeral: true,
    country: str(cfg.country),
    lang: str(cfg.lang),
  };
  return new WindyClient(opts);
}

// ── Misc helpers ──────────────────────────────────────────────────────────

function isoFromMs(ts: number | undefined | null): string | undefined {
  if (ts == null || !Number.isFinite(ts)) return undefined;
  try { return new Date(ts).toISOString(); } catch { return undefined; }
}

function jsonOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  try { return JSON.stringify(v); } catch { return undefined; }
}

function logErr(dl: DriplinePluginAPI, table: string, e: unknown): void {
  if (e instanceof WindyAPIError) {
    dl.log.warn(`${table}: windy ${e.status}: ${e.message}`);
  } else {
    dl.log.warn(`${table}: ${(e as Error)?.message ?? String(e)}`);
  }
}

// Wind u/v → meteorological FROM-direction degrees (0..360)
function windDirFromUV(u: number | undefined, v: number | undefined): number | undefined {
  if (u == null || v == null || !Number.isFinite(u) || !Number.isFinite(v)) return undefined;
  let d = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (d < 0) d += 360;
  return d;
}

// ─────────────────────────────────────────────────────────────────────────
// Plugin entry
// ─────────────────────────────────────────────────────────────────────────

export default function windyPlugin(dl: DriplinePluginAPI): void {
  dl.setName("windy");
  dl.setVersion("0.1.0");

  dl.setConnectionSchema({
    token: {
      type: "string",
      required: false,
      env: "WINDY_TOKEN",
      description:
        "Pre-issued windy JWT (token2 value). Optional — most public endpoints work anonymously.",
    },
    accountSid: {
      type: "string",
      required: false,
      env: "WINDY_ACCOUNT_SID",
      description:
        "_account_sid cookie value from a logged-in browser. Used to bootstrap a JWT when `token` is absent.",
    },
    uid: {
      type: "string",
      required: false,
      env: "WINDY_UID",
      description: "Stable device UUID. Auto-generated per call if omitted.",
    },
    lang: {
      type: "string",
      required: false,
      env: "WINDY_LANG",
      default: "en",
      description: "ISO 639-1 language code.",
    },
    country: {
      type: "string",
      required: false,
      env: "WINDY_COUNTRY",
      default: "xx",
      description: "ISO 3166-1 alpha-2 country code, lowercase.",
    },
    proxy: {
      type: "string",
      required: false,
      env: "WINDY_PROXY",
      description:
        "HTTPS proxy URL for debugging (e.g. http://localhost:8080). Routes all outbound traffic through the proxy.",
    },
  });

  // ── windy_forecast_point ────────────────────────────────────────────────
  dl.registerTable("windy_forecast_point", {
    description:
      "Multi-day point forecast — one row per timestep. Use when the user asks for hour-by-hour weather (temp/wind/precip/pressure) at a coordinate. Filter by `model` (default ecmwf), `step` (1/3/6 h), `ref_time` (ISO). For daily aggregates see `windy_forecast_summary`; for upper-air see `windy_forecast_sounding`.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "model", type: "string" },
      { name: "ref_time", type: "string" },
      { name: "ts_ms", type: "number" },
      { name: "ts", type: "datetime" },
      { name: "temp_k", type: "number" },
      { name: "dewpoint_k", type: "number" },
      { name: "wind_ms", type: "number" },
      { name: "wind_u_ms", type: "number" },
      { name: "wind_v_ms", type: "number" },
      { name: "wind_dir_deg", type: "number" },
      { name: "gust_ms", type: "number" },
      { name: "rh_pct", type: "number" },
      { name: "pressure_hpa", type: "number" },
      { name: "precip_mm", type: "number" },
      { name: "snow_mm", type: "number" },
      { name: "clouds_low", type: "number" },
      { name: "clouds_mid", type: "number" },
      { name: "clouds_high", type: "number" },
      { name: "h_clouds", type: "number" },
      { name: "cape", type: "number" },
      { name: "ptype", type: "number" },
      { name: "elevation_m", type: "number" },
      { name: "model_elevation_m", type: "number" },
      { name: "tz_name", type: "string" },
      { name: "utc_offset_h", type: "number" },
      { name: "sunrise_ms", type: "number" },
      { name: "sunset_ms", type: "number" },
      { name: "days_avail", type: "number" },
      { name: "step_h", type: "number" },
      { name: "has_waves", type: "boolean" },
      { name: "header_raw", type: "json" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "model", required: "optional" },
      { name: "ref_time", required: "optional" },
      { name: "step", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const r: PointForecast = await c.pointForecast(lat, lon, {
          model: qStr(ctx.quals, "model"),
          refTime: qStr(ctx.quals, "ref_time"),
          step: qNum(ctx.quals, "step"),
        });
        const h = r.header;
        const model = h.model;
        const refTime = h.refTime;
        const d = r.data;
        const tsArr = d.ts ?? [];
        const headerRaw = jsonOrUndef(h);
        for (let i = 0; i < tsArr.length; i++) {
          const u = d.wind_u?.[i];
          const v = d.wind_v?.[i];
          yield {
            lat, lon, model, ref_time: refTime,
            ts_ms: tsArr[i],
            ts: isoFromMs(tsArr[i]),
            temp_k: d.temp?.[i],
            dewpoint_k: d.dewpoint?.[i],
            wind_ms: d.wind?.[i],
            wind_u_ms: u,
            wind_v_ms: v,
            wind_dir_deg: windDirFromUV(u, v),
            gust_ms: d.gust?.[i],
            rh_pct: d.rh?.[i],
            pressure_hpa: d.pressure?.[i],
            precip_mm: d.mm?.[i],
            snow_mm: d.snow?.[i],
            clouds_low: d.clouds_low?.[i],
            clouds_mid: d.clouds_mid?.[i],
            clouds_high: d.clouds_high?.[i],
            h_clouds: d.hClouds?.[i],
            cape: d.cape?.[i],
            ptype: d.ptype?.[i],
            elevation_m: h.elevation,
            model_elevation_m: h.modelElevation,
            tz_name: h.tzName,
            utc_offset_h: h.utcOffset,
            sunrise_ms: h.sunrise,
            sunset_ms: h.sunset,
            days_avail: h.daysAvail,
            step_h: h.step,
            has_waves: h.hasWaves,
            header_raw: headerRaw,
          };
        }
      } catch (e) {
        logErr(dl, "windy_forecast_point", e);
      }
    },
  });

  // ── windy_forecast_summary ────────────────────────────────────────────
  // Daily aggregates from setup=summary calls — one row per date.
  dl.registerTable("windy_forecast_summary", {
    description:
      "Daily forecast summary — one row per date with max/min temp, dominant wind, weather icon. Only populated when the underlying call uses setup=summary (which this table always passes).",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "model", type: "string" },
      { name: "ref_time", type: "string" },
      { name: "date", type: "string" },
      { name: "weekday", type: "string" },
      { name: "ts_ms", type: "number" },
      { name: "day_index", type: "number" },
      { name: "day_of_month", type: "number" },
      { name: "icon", type: "number" },
      { name: "temp_max_k", type: "number" },
      { name: "temp_min_k", type: "number" },
      { name: "wind_ms", type: "number" },
      { name: "wind_dir_deg", type: "number" },
      { name: "segments", type: "number" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "model", required: "optional" },
      { name: "ref_time", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const r: PointForecast = await c.pointForecast(lat, lon, {
          model: qStr(ctx.quals, "model"),
          refTime: qStr(ctx.quals, "ref_time"),
          setup: "summary",
        });
        const model = r.header.model;
        const refTime = r.header.refTime;
        for (const [date, s] of Object.entries(r.summary ?? {})) {
          yield {
            lat, lon, model, ref_time: refTime,
            date,
            weekday: s.weekday,
            ts_ms: s.timestamp,
            day_index: s.index,
            day_of_month: s.day,
            icon: s.icon,
            temp_max_k: s.tempMax,
            temp_min_k: s.tempMin,
            wind_ms: s.wind,
            wind_dir_deg: s.windDir,
            segments: s.segments,
          };
        }
      } catch (e) {
        logErr(dl, "windy_forecast_summary", e);
      }
    },
  });

  // ── windy_forecast_now ──────────────────────────────────────────────────
  dl.registerTable("windy_forecast_now", {
    description:
      "Current-conditions snapshot at a point. Single row. Use when the user wants \"right now\" weather without the full forecast time-series — temp / wind / windDir / weather icon / moon phase.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "model", type: "string" },
      { name: "ref_time", type: "string" },
      { name: "temp_k", type: "number" },
      { name: "wind_ms", type: "number" },
      { name: "wind_dir_deg", type: "number" },
      { name: "icon", type: "number" },
      { name: "moon_phase", type: "number" },
      { name: "tz_name", type: "string" },
      { name: "utc_offset_h", type: "number" },
      { name: "elevation_m", type: "number" },
      { name: "sunrise_ms", type: "number" },
      { name: "sunset_ms", type: "number" },
      { name: "header_raw", type: "json" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "model", required: "optional" },
      { name: "ref_time", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const r = (await c.pointNow(lat, lon, {
          model: qStr(ctx.quals, "model"),
          refTime: qStr(ctx.quals, "ref_time"),
        })) as PointForecast;
        const h = r.header;
        yield {
          lat, lon,
          model: h?.model,
          ref_time: h?.refTime,
          temp_k: r.now?.temp,
          wind_ms: r.now?.wind,
          wind_dir_deg: r.now?.windDir,
          icon: r.now?.icon,
          moon_phase: r.now?.moonPhase,
          tz_name: h?.tzName,
          utc_offset_h: h?.utcOffset,
          elevation_m: h?.elevation,
          sunrise_ms: h?.sunrise,
          sunset_ms: h?.sunset,
          header_raw: jsonOrUndef(h),
        };
      } catch (e) {
        logErr(dl, "windy_forecast_now", e);
      }
    },
  });

  // ── windy_forecast_sounding ────────────────────────────────────────────
  // Pressure-level sounding (skew-T) — meteogram pivoted into per-(ts, level).
  dl.registerTable("windy_forecast_sounding", {
    description:
      "Pressure-level sounding (skew-T). One row per (timestep, pressure level). Use for aviation, glider, paragliding, or any upper-air question — wind/temp/dewpoint/RH/height at 17 standard levels from surface up to 10 hPa.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "model", type: "string" },
      { name: "ref_time", type: "string" },
      { name: "ts_ms", type: "number" },
      { name: "ts", type: "datetime" },
      { name: "hours_offset", type: "number", description: "Hours from ref_time." },
      { name: "level", type: "string", description: "Level key (surface, 100m, 850h, …)." },
      { name: "alt_m", type: "number" },
      { name: "alt_ft", type: "number" },
      { name: "temp_k", type: "number" },
      { name: "dewpoint_k", type: "number" },
      { name: "rh_pct", type: "number" },
      { name: "gh_m", type: "number", description: "Geopotential height, m." },
      { name: "wind_u_ms", type: "number" },
      { name: "wind_v_ms", type: "number" },
      { name: "wind_ms", type: "number" },
      { name: "wind_dir_deg", type: "number" },
      { name: "tz_name", type: "string" },
      { name: "step_h", type: "number" },
      { name: "header_raw", type: "json" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "model", required: "optional" },
      { name: "ref_time", required: "optional" },
      { name: "step", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const s: Sounding = await c.sounding(lat, lon, {
          model: qStr(ctx.quals, "model"),
          refTime: qStr(ctx.quals, "ref_time"),
          step: qNum(ctx.quals, "step"),
        });
        const h = s.header;
        const model = h.model;
        const refTime = h.refTime;
        const headerRaw = jsonOrUndef(h);
        for (const t of s.timesteps) {
          for (const lv of t.levels) {
            yield {
              lat, lon, model, ref_time: refTime,
              ts_ms: t.ts,
              ts: isoFromMs(t.ts),
              hours_offset: t.hoursOffset,
              level: lv.level,
              alt_m: lv.altM,
              alt_ft: lv.altFt,
              temp_k: lv.temp,
              dewpoint_k: lv.dewpoint,
              rh_pct: lv.rh,
              gh_m: lv.gh,
              wind_u_ms: lv.wind_u,
              wind_v_ms: lv.wind_v,
              wind_ms: lv.wind,
              wind_dir_deg: lv.windDir,
              tz_name: h.tzName,
              step_h: h.step,
              header_raw: headerRaw,
            };
          }
        }
      } catch (e) {
        logErr(dl, "windy_forecast_sounding", e);
      }
    },
  });

  // ── windy_forecast_air_quality ─────────────────────────────────────────
  dl.registerTable("windy_forecast_air_quality", {
    description:
      "Air-quality forecast time-series (CAMS global or CAMS-Europe). One row per timestep. Use when the user asks about pollutant forecasts (NO2/O3/PM2.5/PM10/SO2/CO/AQI). For measured values at stations see `windy_station_air_quality` and `windy_stations_nearby_air_quality`.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "model", type: "string" },
      { name: "ref_time", type: "string" },
      { name: "ts_ms", type: "number" },
      { name: "ts", type: "datetime" },
      { name: "no2", type: "number" },
      { name: "o3", type: "number" },
      { name: "pm25", type: "number" },
      { name: "pm10", type: "number" },
      { name: "so2", type: "number" },
      { name: "co", type: "number" },
      { name: "aqi", type: "number" },
      { name: "aod550", type: "number" },
      { name: "header_raw", type: "json" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "model", required: "optional" },
      { name: "ref_time", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      const m = qStr(ctx.quals, "model");
      try {
        const c = getClient(ctx);
        const raw = (await c.airQualityForecast(lat, lon, {
          model: m === "camsEu" ? "camsEu" : "cams",
          refTime: qStr(ctx.quals, "ref_time"),
        })) as {
          header: { model: string; refTime: string };
          data: { ts: number[] } & Record<string, number[] | undefined>;
        };
        const model = raw.header.model;
        const refTime = raw.header.refTime;
        const d = raw.data;
        const tsArr = d.ts ?? [];
        const headerRaw = jsonOrUndef(raw.header);
        for (let i = 0; i < tsArr.length; i++) {
          yield {
            lat, lon, model, ref_time: refTime,
            ts_ms: tsArr[i],
            ts: isoFromMs(tsArr[i]),
            no2: d.no2?.[i],
            o3: d.o3?.[i] ?? d.go3?.[i],
            pm25: d.pm25?.[i] ?? d.pm2p5?.[i],
            pm10: d.pm10?.[i],
            so2: d.so2?.[i] ?? d.tcso2?.[i],
            co: d.co?.[i] ?? d.cosc?.[i],
            aqi: d.aqi?.[i],
            aod550: d.aod550?.[i],
            header_raw: headerRaw,
          };
        }
      } catch (e) {
        logErr(dl, "windy_forecast_air_quality", e);
      }
    },
  });

  // ── windy_forecast_models ──────────────────────────────────────────────
  dl.registerTable("windy_forecast_models", {
    description:
      "Forecast model manifest (raw JSON). Use when the user asks which model runs are available, when the last run was issued, or what `ref_time` to pass to other forecast tables. Filter by `model` (default `ecmwf-hres`).",
    columns: [
      { name: "model", type: "string" },
      { name: "premium", type: "boolean" },
      { name: "manifest", type: "json" },
    ],
    keyColumns: [
      { name: "model", required: "optional" },
      { name: "premium", required: "optional" },
    ],
    async *list(ctx) {
      try {
        const c = getClient(ctx);
        const model = qStr(ctx.quals, "model") ?? "ecmwf-hres";
        const premium = qBool(ctx.quals, "premium") ?? true;
        const m = await c.modelManifest(model, premium);
        yield { model, premium, manifest: jsonOrUndef(m) };
      } catch (e) {
        logErr(dl, "windy_forecast_models", e);
      }
    },
  });

  // ── windy_places (location search) ─────────────────────────────────────
  dl.registerTable("windy_places", {
    description:
      "Location text search. Use to resolve a place name to (lat, lon) before calling any other windy table. Results biased toward `bias_lat`/`bias_lon` when supplied (defaults to (0,0)).",
    columns: [
      { name: "query", type: "string" },
      { name: "bias_lat", type: "number" },
      { name: "bias_lon", type: "number" },
      { name: "id", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "title", type: "string" },
      { name: "type", type: "string" },
      { name: "cc", type: "string" },
      { name: "country", type: "string" },
      { name: "region", type: "string" },
      { name: "state", type: "string" },
      { name: "bounds", type: "string" },
      { name: "webcam_id", type: "string" },
    ],
    keyColumns: [
      { name: "query", required: "required" },
      { name: "bias_lat", required: "optional" },
      { name: "bias_lon", required: "optional" },
      { name: "size", required: "optional" },
    ],
    async *list(ctx) {
      const q = qStr(ctx.quals, "query");
      if (!q) return;
      const biasLat = qNum(ctx.quals, "bias_lat") ?? 0;
      const biasLon = qNum(ctx.quals, "bias_lon") ?? 0;
      const size = qNum(ctx.quals, "size") ?? 13;
      try {
        const c = getClient(ctx);
        const r: SearchResponse = await c.search(q, biasLat, biasLon, size);
        for (const x of r.data ?? []) {
          yield {
            query: q,
            bias_lat: biasLat,
            bias_lon: biasLon,
            id: x.id,
            lat: x.lat,
            lon: x.lon,
            title: x.title,
            type: x.type,
            cc: x.cc,
            country: x.country,
            region: x.region,
            state: x.state,
            bounds: x.bounds,
            webcam_id: x.webcamId,
          };
        }
      } catch (e) {
        logErr(dl, "windy_places", e);
      }
    },
  });

  // ── windy_geo_reverse ──────────────────────────────────────────────────
  dl.registerTable("windy_geo_reverse", {
    description:
      "Reverse-geocode a coordinate to suburb / city / district / state / country. Single row. Use when the user has lat/lon and needs a human-readable place name. `zoom` 14 ≈ neighborhood, 10 ≈ city.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "zoom", type: "number" },
      { name: "suburb", type: "string" },
      { name: "city", type: "string" },
      { name: "district", type: "string" },
      { name: "state", type: "string" },
      { name: "country", type: "string" },
      { name: "country_code", type: "string" },
      { name: "location_name", type: "string" },
      { name: "location_id", type: "string" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "zoom", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      const zoom = qNum(ctx.quals, "zoom") ?? 14;
      try {
        const c = getClient(ctx);
        const r: ReverseGeocode = await c.reverseGeocode(lat, lon, zoom);
        yield {
          lat, lon, zoom,
          suburb: r.suburb,
          city: r.city,
          district: r.district,
          state: r.state,
          country: r.country,
          country_code: r.country_code,
          location_name: r.location?.name,
          location_id: r.location?.id,
        };
      } catch (e) {
        logErr(dl, "windy_geo_reverse", e);
      }
    },
  });

  // ── windy_geo_elevation ────────────────────────────────────────────────
  dl.registerTable("windy_geo_elevation", {
    description:
      "Elevation in meters at a coordinate. Single row. Use for questions about altitude, hiking, terrain, or to convert pressure-altitude between AGL/MSL.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "elevation_m", type: "number" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const m = await c.elevation(lat, lon);
        yield { lat, lon, elevation_m: m };
      } catch (e) {
        logErr(dl, "windy_geo_elevation", e);
      }
    },
  });

  // ── windy_geo_timezone ─────────────────────────────────────────────────
  dl.registerTable("windy_geo_timezone", {
    description:
      "Timezone info for a coordinate at an instant (default: now). Use to convert UTC timestamps from forecast tables to local time, or to detect DST transitions at the location.",
    columns: [
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "ts_ms", type: "number" },
      { name: "tz_name", type: "string" },
      { name: "tz_offset_min", type: "number" },
      { name: "tz_abbrev", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "lat", required: "required" },
      { name: "lon", required: "required" },
      { name: "ts_ms", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      if (lat == null || lon == null) return;
      const ts = qNum(ctx.quals, "ts_ms") ?? Date.now();
      try {
        const c = getClient(ctx);
        const r = (await c.timezone(lat, lon, ts)) as Record<string, unknown>;
        yield {
          lat, lon, ts_ms: ts,
          tz_name: str(r?.TZname) ?? str(r?.tzName),
          tz_offset_min: num(r?.TZoffsetMin) ?? num(r?.TZoffset),
          tz_abbrev: str(r?.TZabbrev),
          raw: jsonOrUndef(r),
        };
      } catch (e) {
        logErr(dl, "windy_geo_timezone", e);
      }
    },
  });

  // ── windy_stations_nearby ──────────────────────────────────────────────
  dl.registerTable("windy_stations_nearby", {
    description:
      "Nearby ground weather stations (airport METAR + WMO + PWS + MADIS). Use when the user wants OBSERVED weather (vs. forecast) at the closest reporting site. For per-station history join on `id` into `windy_station_observations`. Distance in km.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "type", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "dist_km", type: "number" },
      { name: "diff_min", type: "number" },
      { name: "h_ago", type: "number" },
      { name: "min_ago", type: "number" },
      { name: "temp_c", type: "number" },
      { name: "wind_ms", type: "number" },
      { name: "gust_ms", type: "number" },
      { name: "dir_deg", type: "number" },
      { name: "precip", type: "number" },
      { name: "qnh_hpa", type: "number" },
      { name: "rh_pct", type: "number" },
      { name: "dew_point_c", type: "number" },
      { name: "wx_icon", type: "number" },
      { name: "is_airport", type: "boolean" },
    ],
    keyColumns: [
      { name: "query_lat", required: "required" },
      { name: "query_lon", required: "required" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const rows: NearbyWeatherStation[] = await c.nearbyStations(lat, lon);
        for (const r of rows ?? []) {
          yield {
            query_lat: lat, query_lon: lon,
            id: r.id, name: r.name, type: r.type,
            lat: r.lat, lon: r.lon, dist_km: r.dist,
            diff_min: r.diff, h_ago: r.hAgo, min_ago: r.minAgo,
            temp_c: r.temp, wind_ms: r.wind, gust_ms: r.gust,
            dir_deg: r.dir, precip: r.precip, qnh_hpa: r.qnh,
            rh_pct: r.rh, dew_point_c: r.dew_point,
            wx_icon: r.wx_icon, is_airport: r.is_airport === 1,
          };
        }
      } catch (e) {
        logErr(dl, "windy_stations_nearby", e);
      }
    },
  });

  // ── windy_stations_nearby_air_quality ──────────────────────────────────
  dl.registerTable("windy_stations_nearby_air_quality", {
    description:
      "Nearby measured air-quality stations (AQI snapshot). Use for OBSERVED AQ. For detailed pollutant breakdown of a single station join `id` into `windy_station_air_quality`. For forecast AQ use `windy_forecast_air_quality`.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "data_source", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "dist_km", type: "number" },
      { name: "aqi", type: "number" },
      { name: "diff_min", type: "number" },
      { name: "h_ago", type: "number" },
      { name: "min_ago", type: "number" },
    ],
    keyColumns: [
      { name: "query_lat", required: "required" },
      { name: "query_lon", required: "required" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const rows: NearbyAirQualityStation[] = await c.nearbyAirQuality(lat, lon);
        for (const r of rows ?? []) {
          yield {
            query_lat: lat, query_lon: lon,
            id: r.id, name: r.name, data_source: r.dataSource,
            lat: r.lat, lon: r.lon, dist_km: r.dist,
            aqi: r.aqi, diff_min: r.diff,
            h_ago: r.hAgo, min_ago: r.minAgo,
          };
        }
      } catch (e) {
        logErr(dl, "windy_stations_nearby_air_quality", e);
      }
    },
  });

  // ── windy_stations_nearby_tides ────────────────────────────────────────
  dl.registerTable("windy_stations_nearby_tides", {
    description:
      "Nearby tide stations (POI list). Use to discover a `poi_id` to pass to `windy_tides` / `windy_tide_extremes`. The raw JSON of each row is preserved in `raw`.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "dist_km", type: "number" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "query_lat", required: "required" },
      { name: "query_lon", required: "required" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const raw = await c.nearbyTides(lat, lon);
        const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { pois?: unknown[] })?.pois) ? (raw as { pois: unknown[] }).pois : [];
        for (const r of rows as Array<Record<string, unknown>>) {
          yield {
            query_lat: lat, query_lon: lon,
            id: str(r.id),
            name: str(r.name),
            lat: num(r.lat),
            lon: num(r.lon),
            dist_km: num(r.dist),
            raw: jsonOrUndef(r),
          };
        }
      } catch (e) {
        logErr(dl, "windy_stations_nearby_tides", e);
      }
    },
  });

  // ── windy_station_air_quality (POI detail) ─────────────────────────────
  dl.registerTable("windy_station_air_quality", {
    description:
      "Detailed latest measurement from one AQ station — full pollutant breakdown (CO/NO2/O3/PM2.5/PM10/SO2 with per-pollutant AQI). Single row. Get the `id` from `windy_stations_nearby_air_quality`.",
    columns: [
      { name: "id", type: "string" },
      { name: "type", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "name", type: "string" },
      { name: "time", type: "string" },
      { name: "data_source", type: "string" },
      { name: "source", type: "string" },
      { name: "station_id", type: "string" },
      { name: "rank", type: "number" },
      { name: "quality", type: "number" },
      { name: "size", type: "number" },
      { name: "diff_min", type: "number" },
      { name: "aqi", type: "number" },
      { name: "co", type: "number" },
      { name: "co_aqi", type: "number" },
      { name: "no2", type: "number" },
      { name: "no2_aqi", type: "number" },
      { name: "o3", type: "number" },
      { name: "o3_aqi", type: "number" },
      { name: "pm10", type: "number" },
      { name: "pm10_aqi", type: "number" },
      { name: "pm25", type: "number" },
      { name: "pm25_aqi", type: "number" },
      { name: "so2", type: "number" },
      { name: "so2_aqi", type: "number" },
    ],
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qStr(ctx.quals, "id");
      if (!id) return;
      try {
        const c = getClient(ctx);
        const r: AirQualityPOI = await c.airQualityStation(id);
        yield {
          id: r.id, type: r.type, lat: r.lat, lon: r.lon, name: r.name, time: r.time,
          data_source: r.dataSource, source: r.source,
          station_id: r.stationID, rank: r.rank, quality: r.quality,
          size: r.size, diff_min: r.diff,
          aqi: r.aqi,
          co: r.co, co_aqi: r.co_aqi,
          no2: r.no2, no2_aqi: r.no2_aqi,
          o3: r.o3, o3_aqi: r.o3_aqi,
          pm10: r.pm10, pm10_aqi: r.pm10_aqi,
          pm25: r.pm25, pm25_aqi: r.pm25_aqi,
          so2: r.so2, so2_aqi: r.so2_aqi,
        };
      } catch (e) {
        logErr(dl, "windy_station_air_quality", e);
      }
    },
  });

  // ── windy_station_observations ─────────────────────────────────────────
  dl.registerTable("windy_station_observations", {
    description:
      "Historical observed time-series for one station — temp / wind / gust / pressure / RH / precip. Use to backtest a forecast, build a microclimate baseline, or grab METAR history. `station_type` ∈ {airq, ad, wmo, pws, madis}. Common params surfaced as columns; full row in `raw`.",
    columns: [
      { name: "station_type", type: "string" },
      { name: "station_id", type: "string" },
      { name: "station_name", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "ts_ms", type: "number" },
      { name: "ts", type: "datetime" },
      { name: "temp", type: "number" },
      { name: "wind", type: "number" },
      { name: "gust", type: "number" },
      { name: "dir", type: "number" },
      { name: "pressure", type: "number" },
      { name: "rh", type: "number" },
      { name: "precip", type: "number" },
      { name: "aqi", type: "number" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "station_type", required: "required" },
      { name: "station_id", required: "required" },
      { name: "days", required: "optional" },
      { name: "step", required: "optional" },
    ],
    async *list(ctx) {
      const type = qStr(ctx.quals, "station_type");
      const id = qStr(ctx.quals, "station_id");
      if (!type || !id) return;
      const allowed = ["airq", "ad", "wmo", "pws", "madis"] as const;
      if (!(allowed as readonly string[]).includes(type)) return;
      const days = qNum(ctx.quals, "days") ?? 10;
      const step = qNum(ctx.quals, "step") ?? 1;
      try {
        const c = getClient(ctx);
        const obs: ObservationTimeseries = await c.observations(
          type as (typeof allowed)[number],
          id,
          days,
          step,
        );
        const d = obs.data;
        const tsArr = d.ts ?? [];
        const name = obs.header?.name;
        const lat = obs.header?.lat;
        const lon = obs.header?.lon;
        for (let i = 0; i < tsArr.length; i++) {
          const rowJson: Record<string, unknown> = { ts_ms: tsArr[i] };
          for (const [k, arr] of Object.entries(d)) {
            if (k === "ts") continue;
            if (Array.isArray(arr)) rowJson[k] = arr[i];
          }
          yield {
            station_type: type,
            station_id: id,
            station_name: name,
            lat, lon,
            ts_ms: tsArr[i],
            ts: isoFromMs(tsArr[i]),
            temp: num(rowJson.temp),
            wind: num(rowJson.wind),
            gust: num(rowJson.gust),
            dir: num(rowJson.dir),
            pressure: num(rowJson.pressure),
            rh: num(rowJson.rh),
            precip: num(rowJson.precip),
            aqi: num(rowJson.aqi),
            raw: jsonOrUndef(rowJson),
          };
        }
      } catch (e) {
        logErr(dl, "windy_station_observations", e);
      }
    },
  });

  // ── windy_tides ────────────────────────────────────────────────────────
  // Long-format heights. Use either (lat,lon) or poi_id to identify the port.
  dl.registerTable("windy_tides", {
    description:
      "Tide-height forecast time-series for a port. Use for sailing, fishing, or coastal-access questions. Provide (`query_lat`, `query_lon`) for nearest-port lookup OR `poi_id` (from `windy_stations_nearby_tides`). Heights in meters above chart datum.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "poi_id", type: "string" },
      { name: "port_name", type: "string" },
      { name: "port_lat", type: "number" },
      { name: "port_lon", type: "number" },
      { name: "tz_name", type: "string" },
      { name: "ts_ms", type: "number" },
      { name: "ts", type: "datetime" },
      { name: "height_m", type: "number" },
      { name: "header_raw", type: "json" },
    ],
    keyColumns: [
      { name: "query_lat", required: "optional" },
      { name: "query_lon", required: "optional" },
      { name: "poi_id", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      const poi = qStr(ctx.quals, "poi_id");
      if (poi == null && (lat == null || lon == null)) return;
      try {
        const c = getClient(ctx);
        const r: TideForecast = poi
          ? await c.tidesByPoi(poi)
          : await c.tides(lat as number, lon as number);
        const portName = str(r.header?.name);
        const portLat = num(r.header?.lat);
        const portLon = num(r.header?.lon);
        const tzName = str(r.header?.tzName);
        const headerRaw = jsonOrUndef(r.header);
        const tsArr = r.data?.ts ?? [];
        const hArr = r.data?.height ?? [];
        for (let i = 0; i < tsArr.length; i++) {
          yield {
            query_lat: lat,
            query_lon: lon,
            poi_id: poi,
            port_name: portName,
            port_lat: portLat,
            port_lon: portLon,
            tz_name: tzName,
            ts_ms: tsArr[i],
            ts: isoFromMs(tsArr[i]),
            height_m: hArr[i],
            header_raw: headerRaw,
          };
        }
      } catch (e) {
        logErr(dl, "windy_tides", e);
      }
    },
  });

  // ── windy_tide_extremes ────────────────────────────────────────────────
  dl.registerTable("windy_tide_extremes", {
    description:
      "Tide high/low turning points (companion to `windy_tides`). Use when the user wants \"next high tide\" or to enumerate daily extremes — no need to scan the full timeseries. `kind` ∈ {`high`, `low`}.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "poi_id", type: "string" },
      { name: "port_name", type: "string" },
      { name: "ts_ms", type: "number" },
      { name: "ts", type: "datetime" },
      { name: "height_m", type: "number" },
      { name: "kind", type: "string" },
    ],
    keyColumns: [
      { name: "query_lat", required: "optional" },
      { name: "query_lon", required: "optional" },
      { name: "poi_id", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      const poi = qStr(ctx.quals, "poi_id");
      if (poi == null && (lat == null || lon == null)) return;
      try {
        const c = getClient(ctx);
        const r: TideForecast = poi
          ? await c.tidesByPoi(poi)
          : await c.tides(lat as number, lon as number);
        const portName = str(r.header?.name);
        for (const e of r.extremes ?? []) {
          yield {
            query_lat: lat,
            query_lon: lon,
            poi_id: poi,
            port_name: portName,
            ts_ms: e.ts,
            ts: isoFromMs(e.ts),
            height_m: e.height,
            kind: e.type,
          };
        }
      } catch (e) {
        logErr(dl, "windy_tide_extremes", e);
      }
    },
  });

  // ── windy_storms ───────────────────────────────────────────────────────
  dl.registerTable("windy_storms", {
    description:
      "Currently-active tropical cyclones worldwide — one row per named storm. Use for hurricane / typhoon / cyclone questions. `wind_speed_ms` is sustained wind; `strength` is Saffir-Simpson category (0 = tropical depression).",
    columns: [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "strength", type: "number" },
      { name: "wind_speed_ms", type: "number" },
    ],
    async *list(ctx) {
      try {
        const c = getClient(ctx);
        const r: StormsResponse = await c.storms();
        for (const s of r.storms ?? []) {
          yield {
            id: s.id, name: s.name, lat: s.lat, lon: s.lon,
            strength: s.strength, wind_speed_ms: s.windSpeed,
          };
        }
      } catch (e) {
        logErr(dl, "windy_storms", e);
      }
    },
  });

  // ── windy_storms_count ─────────────────────────────────────────────────
  dl.registerTable("windy_storms_count", {
    description:
      "Count of active tropical cyclones (single row). Use as a cheap probe before fetching the full `windy_storms` list.",
    columns: [{ name: "count", type: "number" }, { name: "raw", type: "json" }],
    async *list(ctx) {
      try {
        const c = getClient(ctx);
        const r = await c.stormsCount();
        const count =
          typeof r === "number" ? r :
          typeof r === "object" && r !== null && "count" in r ? num((r as { count: unknown }).count) :
          undefined;
        yield { count, raw: jsonOrUndef(r) };
      } catch (e) {
        logErr(dl, "windy_storms_count", e);
      }
    },
  });

  // ── windy_alerts_cap ───────────────────────────────────────────────────
  dl.registerTable("windy_alerts_cap", {
    description:
      "Government-issued severe-weather alerts (CAP feed) in effect at a location — flood / storm / fire / heat. Public, no auth needed. For PERSONAL alerts the user subscribed to see `windy_alerts_live`.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "id", type: "string" },
      { name: "sender", type: "string" },
      { name: "sent", type: "string" },
      { name: "status", type: "string" },
      { name: "msg_type", type: "string" },
      { name: "scope", type: "string" },
      { name: "category", type: "string" },
      { name: "event", type: "string" },
      { name: "urgency", type: "string" },
      { name: "severity", type: "string" },
      { name: "certainty", type: "string" },
      { name: "effective", type: "string" },
      { name: "expires", type: "string" },
      { name: "headline", type: "string" },
      { name: "description", type: "string" },
      { name: "instruction", type: "string" },
    ],
    keyColumns: [
      { name: "query_lat", required: "required" },
      { name: "query_lon", required: "required" },
      { name: "max_count", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      if (lat == null || lon == null) return;
      try {
        const c = getClient(ctx);
        const rows: CapAlert[] | null = await c.capAlerts(lat, lon, {
          maxCount: qNum(ctx.quals, "max_count"),
        });
        for (const a of rows ?? []) {
          yield {
            query_lat: lat, query_lon: lon,
            id: a.id, sender: a.sender, sent: a.sent,
            status: a.status, msg_type: a.msgType, scope: a.scope,
            category: a.info?.category, event: a.info?.event,
            urgency: a.info?.urgency, severity: a.info?.severity,
            certainty: a.info?.certainty,
            effective: a.info?.effective, expires: a.info?.expires,
            headline: a.info?.headline,
            description: a.info?.description,
            instruction: a.info?.instruction,
          };
        }
      } catch (e) {
        logErr(dl, "windy_alerts_cap", e);
      }
    },
  });

  // ── windy_alerts_live (auth) ──────────────────────────────────────────
  dl.registerTable("windy_alerts_live", {
    description:
      "Live alerts the SIGNED-IN user has subscribed to (push-style threshold alarms). Requires auth. For public severe-weather alerts at a location use `windy_alerts_cap`.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "distance", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "query_lat", required: "required" },
      { name: "query_lon", required: "required" },
      { name: "distance", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      if (lat == null || lon == null) return;
      const distance = qStr(ctx.quals, "distance") === "mi" ? "mi" : "km";
      try {
        const c = getClient(ctx);
        const r = await c.liveAlerts(lat, lon, distance);
        for (const a of r.alerts ?? []) {
          yield { query_lat: lat, query_lon: lon, distance, raw: jsonOrUndef(a) };
        }
      } catch (e) {
        logErr(dl, "windy_alerts_live", e);
      }
    },
  });

  // ── windy_webcams_near ─────────────────────────────────────────────────
  dl.registerTable("windy_webcams_near", {
    description:
      "Webcams near a coordinate — one row per cam, with current and last-daylight image URLs. Use for visual ground truth (\"what does it actually look like there?\"). For full detail of a single cam join `id` into `windy_webcam`.",
    columns: [
      { name: "query_lat", type: "number" },
      { name: "query_lon", type: "number" },
      { name: "id", type: "number" },
      { name: "title", type: "string" },
      { name: "last_update_ms", type: "number" },
      { name: "last_daylight_ms", type: "number" },
      { name: "cam_lat", type: "number" },
      { name: "cam_lon", type: "number" },
      { name: "location_title", type: "string" },
      { name: "city", type: "string" },
      { name: "country", type: "string" },
      { name: "image_current", type: "string" },
      { name: "image_daylight", type: "string" },
    ],
    keyColumns: [
      { name: "query_lat", required: "required" },
      { name: "query_lon", required: "required" },
      { name: "limit", required: "optional" },
      { name: "image_size", required: "optional" },
    ],
    async *list(ctx) {
      const lat = qNum(ctx.quals, "query_lat");
      const lon = qNum(ctx.quals, "query_lon");
      if (lat == null || lon == null) return;
      const limit = qNum(ctx.quals, "limit");
      const sz = qStr(ctx.quals, "image_size");
      const imageSize: "thumbnail" | "preview" | "original" =
        sz === "preview" || sz === "original" || sz === "thumbnail" ? sz : "thumbnail";
      try {
        const c = getClient(ctx);
        const r: WebcamList = await c.webcamsNear(lat, lon, { limit, imageSize });
        for (const cam of r.cams ?? []) {
          yield {
            query_lat: lat, query_lon: lon,
            id: cam.id, title: cam.title,
            last_update_ms: cam.lastUpdate,
            last_daylight_ms: cam.lastDaylight,
            cam_lat: cam.location?.lat,
            cam_lon: cam.location?.lon,
            location_title: cam.location?.title,
            city: cam.location?.city,
            country: cam.location?.country,
            image_current: cam.images?.current,
            image_daylight: cam.images?.daylight,
          };
        }
      } catch (e) {
        logErr(dl, "windy_webcams_near", e);
      }
    },
  });

  // ── windy_webcam (detail) ──────────────────────────────────────────────
  dl.registerTable("windy_webcam", {
    description:
      "One webcam by id (single row). Use after `windy_webcams_near` or `windy_webcams_search` to load full detail / fresh image URLs.",
    columns: [
      { name: "id", type: "number" },
      { name: "title", type: "string" },
      { name: "last_update_ms", type: "number" },
      { name: "last_daylight_ms", type: "number" },
      { name: "cam_lat", type: "number" },
      { name: "cam_lon", type: "number" },
      { name: "location_title", type: "string" },
      { name: "city", type: "string" },
      { name: "country", type: "string" },
      { name: "image_current", type: "string" },
      { name: "image_daylight", type: "string" },
      { name: "image_size", type: "string" },
    ],
    keyColumns: [
      { name: "id", required: "required" },
      { name: "image_size", required: "optional" },
    ],
    async *list(ctx) {
      const idStr = qStr(ctx.quals, "id");
      const idNum = qNum(ctx.quals, "id");
      const id = idNum ?? (idStr ? Number(idStr) : undefined);
      if (id == null || !Number.isFinite(id)) return;
      const sz = qStr(ctx.quals, "image_size");
      const imageSize: "thumbnail" | "preview" | "original" =
        sz === "thumbnail" || sz === "original" || sz === "preview" ? sz : "preview";
      try {
        const c = getClient(ctx);
        const cam: Webcam = await c.webcamDetail(id, imageSize);
        yield {
          id: cam.id, title: cam.title,
          last_update_ms: cam.lastUpdate,
          last_daylight_ms: cam.lastDaylight,
          cam_lat: cam.location?.lat,
          cam_lon: cam.location?.lon,
          location_title: cam.location?.title,
          city: cam.location?.city,
          country: cam.location?.country,
          image_current: cam.images?.current,
          image_daylight: cam.images?.daylight,
          image_size: imageSize,
        };
      } catch (e) {
        logErr(dl, "windy_webcam", e);
      }
    },
  });

  // ── windy_webcams_search ───────────────────────────────────────────────
  dl.registerTable("windy_webcams_search", {
    description:
      "Webcam text search by name / location. Use when the user names a place (\"Eiffel Tower\", \"Big Sur\") rather than a coord. Optionally bias by `lat`/`lon`.",
    columns: [
      { name: "query", type: "string" },
      { name: "id", type: "string" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "title", type: "string" },
      { name: "type", type: "string" },
      { name: "cc", type: "string" },
      { name: "country", type: "string" },
      { name: "webcam_id", type: "string" },
    ],
    keyColumns: [
      { name: "query", required: "required" },
      { name: "lat", required: "optional" },
      { name: "lon", required: "optional" },
    ],
    async *list(ctx) {
      const q = qStr(ctx.quals, "query");
      if (!q) return;
      const lat = qNum(ctx.quals, "lat");
      const lon = qNum(ctx.quals, "lon");
      try {
        const c = getClient(ctx);
        const r = (await c.webcamSearch(q, { lat, lon })) as SearchResponse;
        for (const x of r.data ?? []) {
          yield {
            query: q,
            id: x.id, lat: x.lat, lon: x.lon,
            title: x.title, type: x.type,
            cc: x.cc, country: x.country,
            webcam_id: x.webcamId,
          };
        }
      } catch (e) {
        logErr(dl, "windy_webcams_search", e);
      }
    },
  });

  // ── windy_airport ──────────────────────────────────────────────────────
  dl.registerTable("windy_airport", {
    description:
      "Airport info by ICAO code — name, elevation, latest METAR + TAF, frequencies. Single row. Use for aviation context or to fetch METAR/TAF. Runways live in `windy_airport_runways`.",
    columns: [
      { name: "icao", type: "string" },
      { name: "id", type: "string" },
      { name: "iata", type: "string" },
      { name: "subtype", type: "string" },
      { name: "name", type: "string" },
      { name: "source", type: "string" },
      { name: "home_link", type: "string" },
      { name: "wikipedia_link", type: "string" },
      { name: "keywords", type: "string" },
      { name: "elev_ft", type: "number" },
      { name: "elev_m", type: "number" },
      { name: "scheduled_service", type: "boolean" },
      { name: "metar", type: "json" },
      { name: "taf", type: "json" },
      { name: "frequencies", type: "json" },
    ],
    keyColumns: [{ name: "icao", required: "required" }],
    async *list(ctx) {
      const icao = qStr(ctx.quals, "icao");
      if (!icao) return;
      try {
        const c = getClient(ctx);
        const r: AirportResponse = await c.airport(icao);
        const i = r.info;
        yield {
          icao,
          id: i.id, iata: i.iata, subtype: i.subtype, name: i.name,
          source: i.source,
          home_link: i.home_link,
          wikipedia_link: i.wikipedia_link,
          keywords: i.keywords ?? undefined,
          elev_ft: num(i.elev_ft),
          elev_m: num(i.elev_m),
          scheduled_service: i.scheduled_service === "yes",
          metar: jsonOrUndef(i.metar),
          taf: jsonOrUndef(i.taf),
          frequencies: jsonOrUndef(i.frequencies),
        };
      } catch (e) {
        logErr(dl, "windy_airport", e);
      }
    },
  });

  // ── windy_airport_runways ──────────────────────────────────────────────
  dl.registerTable("windy_airport_runways", {
    description:
      "Runways at an airport — one row per runway. Use for aviation route planning (`he_heading_deg`/`le_heading_deg` for wind alignment, `length_ft`/`width_ft`/`surface` for suitability).",
    columns: [
      { name: "icao", type: "string" },
      { name: "runway_id", type: "number" },
      { name: "closed", type: "boolean" },
      { name: "lighted", type: "boolean" },
      { name: "surface", type: "string" },
      { name: "he_ident", type: "string" },
      { name: "le_ident", type: "string" },
      { name: "length_ft", type: "number" },
      { name: "width_ft", type: "number" },
      { name: "he_elev_ft", type: "number" },
      { name: "le_elev_ft", type: "number" },
      { name: "he_heading_deg", type: "number" },
      { name: "le_heading_deg", type: "number" },
      { name: "he_lat", type: "number" },
      { name: "he_lon", type: "number" },
      { name: "le_lat", type: "number" },
      { name: "le_lon", type: "number" },
    ],
    keyColumns: [{ name: "icao", required: "required" }],
    async *list(ctx) {
      const icao = qStr(ctx.quals, "icao");
      if (!icao) return;
      try {
        const c = getClient(ctx);
        const r: AirportResponse = await c.airport(icao);
        for (const rw of r.info?.runways ?? []) {
          yield {
            icao,
            runway_id: rw.id,
            closed: rw.closed === 1,
            lighted: rw.lighted === 1,
            surface: rw.surface,
            he_ident: rw.he_ident,
            le_ident: rw.le_ident,
            length_ft: rw.length_ft,
            width_ft: rw.width_ft,
            he_elev_ft: rw.he_elevation_ft,
            le_elev_ft: rw.le_elevation_ft,
            he_heading_deg: rw.he_heading_degT,
            le_heading_deg: rw.le_heading_degT,
            he_lat: rw.he_latitude_deg,
            he_lon: rw.he_longitude_deg,
            le_lat: rw.le_latitude_deg,
            le_lon: rw.le_longitude_deg,
          };
        }
      } catch (e) {
        logErr(dl, "windy_airport_runways", e);
      }
    },
  });

  // ── windy_account (auth) ──────────────────────────────────────────────
  dl.registerTable("windy_account", {
    description:
      "Signed-in user profile + subscription state (single row). Requires auth. Use to verify auth is working, check premium tier, or fetch the user's id for joins.",
    columns: [
      { name: "auth", type: "boolean" },
      { name: "username", type: "string" },
      { name: "fullname", type: "string" },
      { name: "email", type: "string" },
      { name: "user_id", type: "number" },
      { name: "subscription", type: "string" },
      { name: "subscription_tier", type: "string" },
      { name: "subscription_status", type: "string" },
      { name: "subscription_platform", type: "string" },
      { name: "subscription_expires_ms", type: "number" },
    ],
    async *list(ctx) {
      try {
        const c = getClient(ctx);
        const r: AccountInfo = await c.whoami();
        yield {
          auth: r.auth,
          username: r.userInfo?.username,
          fullname: r.userInfo?.fullname,
          email: r.userInfo?.email,
          user_id: r.userInfo?.id,
          subscription: r.subscription,
          subscription_tier: r.subscriptionInfo?.tier,
          subscription_status: r.subscriptionInfo?.status,
          subscription_platform: r.subscriptionInfo?.platform,
          subscription_expires_ms: r.subscriptionInfo?.expiresAt,
        };
      } catch (e) {
        logErr(dl, "windy_account", e);
      }
    },
  });

  // ── windy_favourites (auth) ───────────────────────────────────────────
  dl.registerTable("windy_favourites", {
    description:
      "Coordinates the user has bookmarked in the windy app. Requires auth. Use to drive batch forecasts for places the user cares about (join lat/lon into `windy_forecast_point` or `windy_forecast_now`).",
    columns: [
      { name: "id", type: "string" },
      { name: "updated_ms", type: "number" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "title", type: "string" },
      { name: "type", type: "string" },
      { name: "version", type: "string" },
      { name: "key", type: "string" },
      { name: "user_id", type: "string" },
      { name: "counter", type: "number" },
      { name: "cc", type: "string" },
      { name: "note", type: "string" },
      { name: "pin", type: "boolean" },
      { name: "pin_order", type: "number" },
      { name: "deleted_ms", type: "number" },
    ],
    async *list(ctx) {
      try {
        const c = getClient(ctx);
        const rows: Favourite[] = await c.favourites();
        for (const f of rows ?? []) {
          const v: FavouriteValue | undefined = f.value;
          yield {
            id: f.id,
            updated_ms: f.updated,
            lat: v?.lat,
            lon: v?.lon,
            title: v?.title,
            type: v?.type,
            version: v?.version,
            key: v?.key,
            user_id: v?.userID,
            counter: v?.counter,
            cc: v?.cc,
            note: v?.note,
            pin: v?.pin,
            pin_order: v?.pinOrder,
            deleted_ms: v?.deleted ?? undefined,
          };
        }
      } catch (e) {
        logErr(dl, "windy_favourites", e);
      }
    },
  });

  // ── windy_user_alerts (auth) ──────────────────────────────────────────
  dl.registerTable("windy_user_alerts", {
    description:
      "Threshold-style weather alarms the user has configured (e.g. \"wind > 10 m/s at home\"). Requires auth. For one alert by id use `windy_user_alert`. For triggered alerts in effect now use `windy_alerts_live`.",
    columns: [
      { name: "id", type: "string" },
      { name: "updated_ms", type: "number" },
      { name: "store_ts_ms", type: "number" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "title", type: "string" },
      { name: "enabled", type: "boolean" },
      { name: "status", type: "string" },
      { name: "user_id", type: "string" },
      { name: "counter", type: "number" },
      { name: "conditions", type: "json" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      try {
        const c = getClient(ctx);
        const rows: UserAlertItem[] | null = await c.userAlerts();
        for (const a of rows ?? []) {
          const v = a.value;
          yield {
            id: a.id,
            updated_ms: a.updated,
            store_ts_ms: a.storeTs,
            lat: v?.lat,
            lon: v?.lon,
            title: v?.title,
            enabled: v?.enabled,
            status: v?.status,
            user_id: v?.userID,
            counter: v?.counter,
            conditions: jsonOrUndef(v?.conditions),
            raw: jsonOrUndef(a),
          };
        }
      } catch (e) {
        logErr(dl, "windy_user_alerts", e);
      }
    },
  });

  // ── windy_user_alert (auth, by id) ────────────────────────────────────
  dl.registerTable("windy_user_alert", {
    description:
      "One user alert by id (single row). Requires auth. Use after `windy_user_alerts` to inspect the full condition tree.",
    columns: [
      { name: "id", type: "string" },
      { name: "updated_ms", type: "number" },
      { name: "store_ts_ms", type: "number" },
      { name: "lat", type: "number" },
      { name: "lon", type: "number" },
      { name: "title", type: "string" },
      { name: "enabled", type: "boolean" },
      { name: "status", type: "string" },
      { name: "user_id", type: "string" },
      { name: "counter", type: "number" },
      { name: "conditions", type: "json" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qStr(ctx.quals, "id");
      if (!id) return;
      try {
        const c = getClient(ctx);
        const a: UserAlertItem = await c.getUserAlert(id);
        const v = a.value;
        yield {
          id: a.id ?? id,
          updated_ms: a.updated,
          store_ts_ms: a.storeTs,
          lat: v?.lat,
          lon: v?.lon,
          title: v?.title,
          enabled: v?.enabled,
          status: v?.status,
          user_id: v?.userID,
          counter: v?.counter,
          conditions: jsonOrUndef(v?.conditions),
          raw: jsonOrUndef(a),
        };
      } catch (e) {
        logErr(dl, "windy_user_alert", e);
      }
    },
  });
}
