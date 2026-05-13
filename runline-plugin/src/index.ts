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
  });

  // ── Forecast ────────────────────────────────────────────────────────────

  rl.registerAction("forecast.point", {
    description:
      "Multi-day point forecast. Returns hourly (or daily-summary) values for the chosen model.",
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
    description: "Current-conditions snapshot at a point (single timestep).",
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
    description: "Hourly multi-parameter meteogram for a point (surface + pressure levels).",
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
    description: "Air-quality forecast at a point (CAMS global or CAMS-Europe).",
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
      "Skew-T sounding (pressure-level profile) for a point. Returns per-timestep × per-level samples with derived wind speed/direction.",
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
      "List available model reftimes & premium gating from the model manifest.",
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
    description: "Location text search biased to a coordinate.",
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
    description: "Reverse geocode a coordinate. Zoom 14 ≈ neighborhood, 10 ≈ city.",
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
    description: "Elevation in meters at a coordinate.",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(async () => ({ elevationM: await c.elevation(num(input.lat)!, num(input.lon)!) }));
    },
  });

  rl.registerAction("geo.timezone", {
    description: "Timezone info for a coordinate at an instant.",
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
    description: "Nearby weather stations (airport METAR + WMO + PWS + MADIS).",
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
    description: "Nearby air-quality monitoring stations.",
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
    description: "Nearby tide stations.",
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
    description: "Air-quality POI detail (latest measurement).",
    inputSchema: {
      id: { type: "string", required: true, description: "Station id (with or without `airq-` prefix)." },
    },
    async execute(input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.airQualityStation(String(input.id)));
    },
  });

  rl.registerAction("stations.observations", {
    description: "Historical observation timeseries for a station.",
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
    description: "Tide forecast for the nearest port to a coordinate.",
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
    description: "Tide forecast by tide-POI id.",
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
      "Public CAP (government-issued severe weather) alerts at a location.",
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
    description: "Live alerts subscribed by the current user (requires auth).",
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
    description: "Active tropical storms worldwide.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.storms());
    },
  });

  rl.registerAction("storms.count", {
    description: "Count of active tropical storms.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.stormsCount());
    },
  });

  // ── Webcams ─────────────────────────────────────────────────────────────

  rl.registerAction("webcams.near", {
    description: "Webcams near a coordinate.",
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
    description: "Webcam detail by id.",
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
    description: "Webcam text search (admin), optionally biased by lat/lon.",
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
    description: "Airport info by ICAO code — runways, METAR, TAF, metadata.",
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
    description: "Current user info / subscription.",
    inputSchema: {},
    async execute(_input: Input, ctx: Ctx) {
      const c = getClient(ctx);
      return run(() => c.whoami());
    },
  });

  rl.registerAction("account.favourites", {
    description: "List the user's favourites (requires auth).",
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
