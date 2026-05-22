/**
 * `@yosit/runline-plugin-windy` — windy.com as typed agent actions.
 *
 * What this is: a runline plugin exposing the windy.com API as ~30 typed
 * actions an agent can call directly. Use when the user asks about
 * weather forecasts, marine, air quality, severe-weather alerts,
 * tropical storms, tides, METAR/airports, weather stations, or webcams.
 * For SQL-style aggregation across many points see the sibling
 * `@yosit/dripline-plugin-windy`.
 *
 * Auth (all optional — most actions work anonymously):
 *   - `WINDY_ACCOUNT_SID` (recommended) — `_account_sid` cookie value;
 *     long-lived; auto-refreshes a JWT. Required for `account.*` and
 *     `alerts.live`.
 *   - `WINDY_TOKEN` — pre-issued JWT (~48 h), no refresh.
 *   - `WINDY_PROXY` — HTTPS proxy URL for debugging.
 *
 * Top actions to know:
 *   - `forecast.point` — hourly point forecast (any model).
 *   - `forecast.now` — current-conditions snapshot.
 *   - `forecast.sounding` — pressure-level sounding (aviation / soaring).
 *   - `search.places` — resolve a place name to lat/lon.
 *   - `storms.list` — active tropical cyclones.
 *   - `alerts.cap` — public severe-weather alerts at a location.
 *
 * Units stay on the wire: temperature Kelvin, wind m/s, pressure hPa,
 * timestamps unix ms UTC. Consumers convert.
 */
import type { RunlinePluginAPI } from "runline";
import { randomUUID } from "crypto";
import {
  WindyClient,
  WindyAPIError,
  type ClientOptions,
  type PersistedSession,
} from "@yosit/windy-skill";

type Ctx = { connection: { config: Record<string, unknown> } };
type Input = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function getClient(ctx: Ctx): WindyClient {
  const cfg = ctx.connection.config;
  const token = str(cfg.token);
  const accountSid = str(cfg.accountSid);
  // Propagate proxy URL to env so the client's lazy proxy-agent picks it up.
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

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WindyAPIError) {
      throw new Error(`windy ${e.status}: ${e.message}`);
    }
    throw e;
  }
}

export default function windy(rl: RunlinePluginAPI) {
  rl.setName("windy");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    token: {
      type: "string",
      required: false,
      description:
        "Pre-issued windy JWT (token2). Optional — most public endpoints work anonymously.",
      env: "WINDY_TOKEN",
    },
    accountSid: {
      type: "string",
      required: false,
      description:
        "_account_sid cookie value from a logged-in browser. Used to bootstrap a JWT when `token` is omitted.",
      env: "WINDY_ACCOUNT_SID",
    },
    lang: {
      type: "string",
      required: false,
      description: "ISO 639-1 language code (default `en`).",
      env: "WINDY_LANG",
      default: "en",
    },
    country: {
      type: "string",
      required: false,
      description: "ISO 3166-1 alpha-2 country code, lowercase (default `xx`).",
      env: "WINDY_COUNTRY",
      default: "xx",
    },
    uid: {
      type: "string",
      required: false,
      description: "Stable device UUID for the `uid` query param. Auto-generated per-call if omitted.",
      env: "WINDY_UID",
    },
    proxy: {
      type: "string",
      required: false,
      description: "HTTPS proxy URL for debugging (e.g. `http://localhost:8080`). Routes all outbound traffic through the proxy.",
      env: "WINDY_PROXY",
    },
  });

  // ── Forecast ────────────────────────────────────────────────────────────

  rl.registerAction("forecast.point", {
    description:
      "Hourly multi-day forecast for one coordinate. Use when the user asks 'will it rain in N hours' or wants a temp/wind/precip series. Returns `{header, data, now, summary?}`; `data` arrays are parallel to `data.ts`. Pass `setup:'summary'` for daily aggregates.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude (deg)" },
      lon: { type: "number", required: true, description: "Longitude (deg)" },
      model: {
        type: "string",
        required: false,
        description: "Forecast model (default `ecmwf`). e.g. ecmwf, gfs, icon, nems, arome.",
        default: "ecmwf",
      },
      refTime: {
        type: "string",
        required: false,
        description: "Model run ISO timestamp. Omit for latest.",
      },
      setup: {
        type: "string",
        required: false,
        description: "`summary` returns daily aggregates; omit for full hourly.",
        enum: ["summary"],
      },
      includeNow: { type: "boolean", required: false, description: "Include current-conditions row." },
      step: { type: "number", required: false, description: "Hours per sample (1, 3, 6)." },
      interpolate: { type: "boolean", required: false, description: "Spatially interpolate between grid cells." },
      extended: { type: "boolean", required: false, description: "Extended-range output (where available)." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.pointForecast(num(input.lat)!, num(input.lon)!, {
          model: str(input.model),
          refTime: str(input.refTime),
          setup: str(input.setup) === "summary" ? "summary" : undefined,
          includeNow: bool(input.includeNow),
          step: num(input.step),
          interpolate: bool(input.interpolate),
          extended: bool(input.extended),
        }),
      );
    },
  });

  rl.registerAction("forecast.now", {
    description:
      "Current-conditions snapshot at one coord — temp / wind / windDir / weather icon / moon phase. Use for 'what's the weather right now?' without paying for a full hourly series.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      model: { type: "string", required: false, description: "Forecast model.", default: "ecmwf" },
      refTime: { type: "string", required: false, description: "Model run timestamp." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.pointNow(num(input.lat)!, num(input.lon)!, {
          model: str(input.model),
          refTime: str(input.refTime),
        }),
      );
    },
  });

  rl.registerAction("forecast.meteogram", {
    description:
      "Raw meteogram (surface + 17 pressure levels, hourly). Use only if you need fields beyond `forecast.point` (turbulence, cape, multi-level wind). For a clean per-level pivot use `forecast.sounding`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      model: { type: "string", required: false, description: "Forecast model." },
      refTime: { type: "string", required: false, description: "Model run timestamp." },
      step: { type: "number", required: false, description: "Hours per sample." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.meteogram(num(input.lat)!, num(input.lon)!, {
          model: str(input.model),
          refTime: str(input.refTime),
          step: num(input.step),
        }),
      );
    },
  });

  rl.registerAction("forecast.airQuality", {
    description:
      "Hourly air-quality forecast (CAMS global or camsEu Europe). Use when the user asks about pollutant forecasts (NO2/O3/PM2.5/PM10/SO2/CO/AQI). For measured station data use `stations.airQualityDetail`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      model: {
        type: "string",
        required: false,
        description: "`cams` (global) or `camsEu` (Europe).",
        enum: ["cams", "camsEu"],
        default: "cams",
      },
      refTime: { type: "string", required: false, description: "Model run timestamp." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      const model = str(input.model);
      return run(() =>
        c.airQualityForecast(num(input.lat)!, num(input.lon)!, {
          model: model === "camsEu" ? "camsEu" : "cams",
          refTime: str(input.refTime),
        }),
      );
    },
  });

  rl.registerAction("forecast.sounding", {
    description:
      "Pressure-level sounding (skew-T) — per-timestep × per-level samples with derived wind speed/direction. Use for aviation, glider, paragliding, or any upper-air question.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      model: { type: "string", required: false, description: "Forecast model." },
      refTime: { type: "string", required: false, description: "Model run timestamp." },
      step: { type: "number", required: false, description: "Hours per sample." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.sounding(num(input.lat)!, num(input.lon)!, {
          model: str(input.model),
          refTime: str(input.refTime),
          step: num(input.step),
        }),
      );
    },
  });

  rl.registerAction("forecast.modelManifest", {
    description:
      "Available model reftimes + premium gating. Use to discover the latest `refTime` for a model before calling `forecast.point` / `forecast.meteogram` with an explicit run.",
    inputSchema: {
      model: {
        type: "string",
        required: false,
        description: "Model identifier (default `ecmwf-hres`).",
        default: "ecmwf-hres",
      },
      premium: { type: "boolean", required: false, description: "Include premium reftimes.", default: true },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.modelManifest(str(input.model), bool(input.premium) ?? true));
    },
  });

  // ── Search / geocoding ──────────────────────────────────────────────────

  rl.registerAction("search.places", {
    description:
      "Resolve a place name to (lat, lon). Use as the first step when the user names a place (\"Reykjavik\", \"Big Sur\") instead of coords. Results biased toward (`biasLat`, `biasLon`) for disambiguation.",
    inputSchema: {
      query: { type: "string", required: true, description: "Free-text query" },
      biasLat: { type: "number", required: true, description: "Bias-point latitude" },
      biasLon: { type: "number", required: true, description: "Bias-point longitude" },
      size: { type: "number", required: false, description: "Max results (default 13).", default: 13 },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.search(
          String(input.query),
          num(input.biasLat)!,
          num(input.biasLon)!,
          num(input.size) ?? 13,
        ),
      );
    },
  });

  rl.registerAction("geo.reverse", {
    description:
      "Reverse-geocode a coord to suburb / city / district / state / country. Use when you have lat/lon and need a human-readable label. `zoom` 14 ≈ neighborhood, 10 ≈ city.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      zoom: { type: "number", required: false, description: "Detail level (default 14).", default: 14 },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.reverseGeocode(num(input.lat)!, num(input.lon)!, num(input.zoom) ?? 14));
    },
  });

  rl.registerAction("geo.elevation", {
    description:
      "Elevation in meters at a coord (returns a bare number). Use for altitude / terrain questions or pressure-altitude conversions.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.elevation(num(input.lat)!, num(input.lon)!));
    },
  });

  rl.registerAction("geo.timezone", {
    description:
      "Timezone metadata at a coord and instant (default: now). Use to convert UTC forecast timestamps to local time, or to detect DST transitions.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      ts: {
        type: "number",
        required: false,
        description: "Unix ms timestamp (default: now).",
      },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.timezone(num(input.lat)!, num(input.lon)!, num(input.ts) ?? Date.now()));
    },
  });

  // ── Stations / POIs ─────────────────────────────────────────────────────

  rl.registerAction("stations.nearby", {
    description:
      "Nearby ground weather stations (METAR + WMO + PWS + MADIS) with latest obs. Use when the user wants OBSERVED weather (vs forecast). Feed `id` into `stations.observations` for history.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.nearbyStations(num(input.lat)!, num(input.lon)!));
    },
  });

  rl.registerAction("stations.nearbyAirQuality", {
    description:
      "Nearby measured AQ stations with current AQI snapshot. Feed `id` into `stations.airQualityDetail` for the full pollutant breakdown. For forecast AQ use `forecast.airQuality`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.nearbyAirQuality(num(input.lat)!, num(input.lon)!));
    },
  });

  rl.registerAction("stations.nearbyTides", {
    description:
      "Nearby tide POIs (port list). Use to discover a `poiId` to pass to `tides.byPoi`. If you just want tides at a coord, `tides.point` is enough.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.nearbyTides(num(input.lat)!, num(input.lon)!));
    },
  });

  rl.registerAction("stations.airQualityDetail", {
    description:
      "Full latest measurement at one AQ station — every pollutant + its per-pollutant AQI. Use after `stations.nearbyAirQuality` once you've picked an `id`.",
    inputSchema: {
      id: { type: "string", required: true, description: "Station id (with or without `airq-` prefix)." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.airQualityStation(String(input.id)));
    },
  });

  rl.registerAction("stations.observations", {
    description:
      "Historical observation time-series for one station — temp / wind / gust / pressure / RH / precip. Use to backtest a forecast or build a microclimate baseline. `type` ∈ {airq, ad, wmo, pws, madis}.",
    inputSchema: {
      type: {
        type: "string",
        required: true,
        description: "Station type.",
        enum: ["airq", "ad", "wmo", "pws", "madis"],
      },
      id: { type: "string", required: true, description: "Station id (with or without type prefix)." },
      days: {
        type: "number",
        required: false,
        description: "Look-back window in days (1, 3, 7, 10, 30).",
        default: 10,
      },
      step: {
        type: "number",
        required: false,
        description: "Hours per sample (1 = hourly, 3 = 3-hourly, 24 = daily).",
        default: 1,
      },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.observations(
          str(input.type) as "airq" | "ad" | "wmo" | "pws" | "madis",
          String(input.id),
          num(input.days) ?? 10,
          num(input.step) ?? 1,
        ),
      );
    },
  });

  // ── Tides ───────────────────────────────────────────────────────────────

  rl.registerAction("tides.point", {
    description:
      "Tide-height forecast at the port nearest a coord. Use for sailing / fishing / coastal-access questions. For a specific port use `tides.byPoi`. Returns `{header, data, extremes}` — `data.height` parallels `data.ts`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.tides(num(input.lat)!, num(input.lon)!));
    },
  });

  rl.registerAction("tides.byPoi", {
    description:
      "Tide-height forecast for a specific tide-POI. Use after `stations.nearbyTides` returns a `poiId` you want to pin to.",
    inputSchema: {
      poiId: { type: "string", required: true, description: "Tide POI id." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.tidesByPoi(String(input.poiId)));
    },
  });

  // ── Alerts ──────────────────────────────────────────────────────────────

  rl.registerAction("alerts.cap", {
    description:
      "Government-issued severe-weather alerts (CAP) in effect at a location — flood / storm / fire / heat. Public, no auth. For PERSONAL alerts the user subscribed to see `alerts.live`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      maxCount: { type: "number", required: false, description: "Max alerts (default 6).", default: 6 },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.capAlerts(num(input.lat)!, num(input.lon)!, { maxCount: num(input.maxCount) }),
      );
    },
  });

  rl.registerAction("alerts.live", {
    description:
      "Live alerts the SIGNED-IN user subscribed to (push-style threshold alarms). Requires auth. For public severe-weather at a location use `alerts.cap`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      distance: {
        type: "string",
        required: false,
        description: "Distance unit (`km` or `mi`).",
        enum: ["km", "mi"],
        default: "km",
      },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      const d = str(input.distance) === "mi" ? "mi" : "km";
      return run(() => c.liveAlerts(num(input.lat)!, num(input.lon)!, d));
    },
  });

  // ── Storms ──────────────────────────────────────────────────────────────

  rl.registerAction("storms.list", {
    description:
      "Currently-active tropical cyclones worldwide. Use for hurricane / typhoon / cyclone questions. Returns `{storms, models, defaultCircles}`; storm `strength` is Saffir-Simpson category (0 = tropical depression).",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.storms());
    },
  });

  rl.registerAction("storms.count", {
    description:
      "Cheap probe — count of active tropical cyclones. Use before fetching the full `storms.list` if you only need a number.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.stormsCount());
    },
  });

  // ── Webcams ─────────────────────────────────────────────────────────────

  rl.registerAction("webcams.near", {
    description:
      "Webcams near a coord with current image URLs. Use for visual ground truth (\"what does it actually look like there?\"). For full detail use `webcams.detail`.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      limit: { type: "number", required: false, description: "Max results." },
      imageSize: {
        type: "string",
        required: false,
        description: "Image variant.",
        enum: ["thumbnail", "preview", "original"],
        default: "thumbnail",
      },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      const sz = str(input.imageSize);
      return run(() =>
        c.webcamsNear(num(input.lat)!, num(input.lon)!, {
          limit: num(input.limit),
          imageSize:
            sz === "preview" || sz === "original" || sz === "thumbnail" ? sz : "thumbnail",
        }),
      );
    },
  });

  rl.registerAction("webcams.detail", {
    description:
      "Full detail for one webcam by id (location, freshest image URLs). Use after `webcams.near` or `webcams.search` to grab a high-res frame.",
    inputSchema: {
      id: { type: "string", required: true, description: "Webcam id." },
      imageSize: {
        type: "string",
        required: false,
        description: "Image variant.",
        enum: ["thumbnail", "preview", "original"],
        default: "preview",
      },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      const sz = str(input.imageSize);
      return run(() =>
        c.webcamDetail(
          String(input.id),
          sz === "thumbnail" || sz === "original" || sz === "preview" ? sz : "preview",
        ),
      );
    },
  });

  rl.registerAction("webcams.search", {
    description:
      "Webcam text search by name / location. Use when the user names a place (\"Eiffel Tower\", \"Big Sur\") instead of giving coords.",
    inputSchema: {
      query: { type: "string", required: true, description: "Search text." },
      lat: { type: "number", required: false, description: "Bias latitude." },
      lon: { type: "number", required: false, description: "Bias longitude." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() =>
        c.webcamSearch(String(input.query), { lat: num(input.lat), lon: num(input.lon) }),
      );
    },
  });

  // ── Airports ────────────────────────────────────────────────────────────

  rl.registerAction("airports.info", {
    description:
      "Airport info by ICAO — name, elevation, runways (with headings + surface), latest METAR/TAF, frequencies. Use for aviation context (alternate planning, METAR/TAF lookup, runway alignment with surface wind).",
    inputSchema: {
      icao: { type: "string", required: true, description: "ICAO code (e.g. KJFK, EGLL, LLBG)." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.airport(String(input.icao)));
    },
  });

  // ── Account ─────────────────────────────────────────────────────────────

  rl.registerAction("account.whoami", {
    description:
      "Signed-in user profile + subscription state. Use to verify auth is wired up, check premium tier, or grab the user id.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.whoami());
    },
  });

  rl.registerAction("account.favourites", {
    description:
      "Coordinates the user has bookmarked in the windy app. Requires auth. Use to drive batch forecasts for places the user cares about.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.favourites());
    },
  });

  rl.registerAction("account.addFavourite", {
    description: "Create a favourite (server assigns id).",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      title: { type: "string", required: false, description: "Display title." },
      name: { type: "string", required: false, description: "Internal name." },
      type: { type: "string", required: false, description: "Favourite type (e.g. `fav`)." },
      cc: { type: "string", required: false, description: "ISO 3166-1 alpha-2 country code." },
      note: { type: "string", required: false, description: "User-supplied note." },
      pin: { type: "boolean", required: false, description: "Pin to top of favourites list." },
      pinOrder: { type: "number", required: false, description: "Sort order among pinned favourites (lower = higher)." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      const value: Record<string, unknown> = {
        lat: num(input.lat)!,
        lon: num(input.lon)!,
      };
      if (str(input.title)) value.title = str(input.title);
      if (str(input.name)) value.name = str(input.name);
      if (str(input.type)) value.type = str(input.type);
      if (str(input.cc)) value.cc = str(input.cc);
      if (str(input.note)) value.note = str(input.note);
      if (bool(input.pin) !== undefined) value.pin = bool(input.pin);
      if (num(input.pinOrder) !== undefined) value.pinOrder = num(input.pinOrder);
      return run(() => c.addFavourite(value as Parameters<WindyClient["addFavourite"]>[0]));
    },
  });

  rl.registerAction("account.updateFavourite", {
    description: "Update an existing favourite by id.",
    inputSchema: {
      id: { type: "string", required: true, description: "Favourite id." },
      patch: {
        type: "object",
        required: true,
        description: "Partial favourite value to merge (lat/lon/title/name/type).",
      },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      const patch = (input.patch ?? {}) as Record<string, unknown>;
      return run(() => c.updateFavourite(String(input.id), patch));
    },
  });

  rl.registerAction("account.deleteFavourite", {
    description: "Delete a favourite by id.",
    inputSchema: {
      id: { type: "string", required: true, description: "Favourite id." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.deleteFavourite(String(input.id)));
    },
  });

  rl.registerAction("account.userAlerts", {
    description: "List the user's saved alerts.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.userAlerts());
    },
  });

  rl.registerAction("account.userAlert", {
    description: "Get a single user alert by id.",
    inputSchema: {
      id: { type: "string", required: true, description: "Alert id." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.getUserAlert(String(input.id)));
    },
  });

  rl.registerAction("account.deleteUserAlert", {
    description: "Delete a user alert by id.",
    inputSchema: {
      id: { type: "string", required: true, description: "Alert id." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.deleteUserAlert(String(input.id)));
    },
  });
}
