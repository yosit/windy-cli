#!/usr/bin/env node

import { Command, Option } from 'commander';
import { WindyClient, WindyAPIError } from './client';
import { sessionPath, saveSession, loadSession } from './session';
import {
  DEFAULT_OUTPUT_FORMAT,
  formatToon,
  OUTPUT_FORMAT_CHOICES,
  type OutputFormat,
} from './formatters';
import {
  POINT_MODELS,
  AIR_QUALITY_MODELS,
  MODEL_CATALOG,
  PREMIUM_FEATURES,
  OVERLAYS,
  LEVELS,
  LEVEL_ALTITUDE,
  BASEMAP_STYLES,
  SUPPORTED_LANGUAGES,
  type BasemapStyle,
} from './types';

let globalFormat: OutputFormat = DEFAULT_OUTPUT_FORMAT;

function out(data: unknown): void {
  if (data === null || data === undefined) {
    console.log(globalFormat === 'json' ? 'null' : '(no data)');
    return;
  }
  if (globalFormat === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(formatToon(data));
}

function die(msg: string, code = 1): never {
  process.stderr.write(`error: ${msg}\n`);
  return process.exit(code) as never;
}

function parseCoord(s: string, name: string): number {
  const n = Number(s);
  if (Number.isNaN(n)) die(`${name} must be a number, got: ${s}`);
  return n;
}

function parseLatLon(arg: string): [number, number] {
  // Accept "lat,lon" or "lat lon"
  const parts = arg.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 2) die(`expected "lat,lon" got: ${arg}`);
  return [parseCoord(parts[0], 'lat'), parseCoord(parts[1], 'lon')];
}

async function withClient<T>(fn: (c: WindyClient) => Promise<T>): Promise<void> {
  try {
    const client = WindyClient.fromEnv();
    const result = await fn(client);
    out(result);
  } catch (err: unknown) {
    if (err instanceof WindyAPIError) die(`HTTP ${err.status}: ${err.message}`);
    die(err instanceof Error ? err.message : String(err));
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('windy')
    .description(
      'CLI for windy.com. Session lives in ~/.config/windy-cli/session.json. ' +
        'Anonymous mode works for most public endpoints; log in to unlock favourites, ' +
        'user alerts, and premium-gated forecasts.',
    )
    .version('0.1.0')
    .addOption(
      new Option('--format <type>', 'Output format')
        .choices([...OUTPUT_FORMAT_CHOICES])
        .default(DEFAULT_OUTPUT_FORMAT),
    )
    .option('--timeout <ms>', 'HTTP timeout (ms)', '30000')
    .option('--lang <code>', 'ISO 639-1 language', 'en')
    .option('--country <code>', 'ISO 3166-1 alpha-2 country (lowercase)', 'xx')
    .hook('preAction', (cmd) => {
      const o = cmd.optsWithGlobals();
      if (o.format) globalFormat = o.format as OutputFormat;
      if (o.timeout) process.env.WINDY_HTTP_TIMEOUT = String(o.timeout);
    });

  // ── Session / auth ──────────────────────────────────────────────────────

  program
    .command('login')
    .description(
      'Authenticate by providing the _account_sid cookie from a logged-in browser session. ' +
        'Open windy.com in Chrome, log in, then DevTools → Application → Cookies → ' +
        'copy the value of _account_sid.',
    )
    .requiredOption('-c, --cookie <value>', '_account_sid cookie value')
    .action(async (opts) => {
      const session = loadSession();
      session.accountSid = opts.cookie;
      saveSession(session);
      const client = new WindyClient({ session });
      const info = await client.refreshAuth();
      out({
        message: 'logged in',
        username: info.userInfo?.username,
        userId: info.userInfo?.id,
        subscription: info.subscription,
        sessionPath: sessionPath(),
      });
    });

  program
    .command('logout')
    .description('Forget the stored session.')
    .action(() => {
      const s = loadSession();
      delete s.accountSid;
      delete s.token;
      delete s.tokenExp;
      delete s.userId;
      delete s.username;
      delete s.subscription;
      saveSession(s);
      out({ message: 'session cleared', sessionPath: sessionPath() });
    });

  program
    .command('whoami')
    .description('Refresh JWT and show current user / subscription.')
    .action(() => withClient((c) => c.whoami()));

  program
    .command('session')
    .description('Show the active session (token claims, file path).')
    .action(() => {
      const s = loadSession();
      const client = new WindyClient({ session: s });
      out({
        sessionPath: sessionPath(),
        uid: s.uid,
        hasCookie: !!s.accountSid,
        hasToken: !!s.token,
        tokenClaims: client.decodeToken(),
        username: s.username,
        userId: s.userId,
        subscription: s.subscription,
      });
    });

  // ── Forecast ────────────────────────────────────────────────────────────

  const forecast = program.command('forecast').description('Forecast endpoints.');

  forecast
    .command('point <lat,lon>')
    .description('Multi-day point forecast.')
    .addOption(new Option('-m, --model <name>', 'forecast model').default('ecmwf'))
    .option('--ref-time <iso>', 'override model reference time')
    .addOption(
      new Option('--setup <kind>', 'forecast setup')
        .choices(['summary', 'full'])
        .default('summary'),
    )
    .option('--step <hours>', 'sample interval in hours')
    .option('--no-now', 'omit current-conditions snapshot')
    .option('--interpolate', 'interpolate values')
    .option('--extended', 'request extended (15-day, premium) window')
    .action(async (latlon: string, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.pointForecast(lat, lon, {
          model: opts.model,
          refTime: opts.refTime,
          setup: opts.setup === 'summary' ? 'summary' : undefined,
          step: opts.step ? Number(opts.step) : undefined,
          includeNow: opts.now,
          interpolate: opts.interpolate,
          extended: opts.extended,
        });
      }),
    );

  forecast
    .command('now <lat,lon>')
    .description('Current-conditions snapshot.')
    .option('-m, --model <name>', 'forecast model', 'ecmwf')
    .option('--ref-time <iso>', 'override model reference time')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.pointNow(lat, lon, { model: opts.model, refTime: opts.refTime });
      }),
    );

  forecast
    .command('meteogram <lat,lon>')
    .description('Hourly meteogram (multi-parameter).')
    .option('-m, --model <name>', 'forecast model', 'ecmwf')
    .option('--ref-time <iso>')
    .option('--step <hours>')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.meteogram(lat, lon, {
          model: opts.model,
          refTime: opts.refTime,
          step: opts.step ? Number(opts.step) : undefined,
        });
      }),
    );

  forecast
    .command('airq <lat,lon>')
    .description('Air-quality forecast (CAMS).')
    .addOption(new Option('-m, --model <name>').choices([...AIR_QUALITY_MODELS]).default('cams'))
    .option('--ref-time <iso>')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.airQualityForecast(lat, lon, {
          model: opts.model,
          refTime: opts.refTime,
        });
      }),
    );

  forecast
    .command('models')
    .description('List supported forecast models with resolution, refresh interval, and premium uplift.')
    .option('--keys-only', 'just print the key list')
    .option('--scope <kind>', 'filter by scope: global | regional')
    .option('--domain <kind>', 'filter by domain: general | waves | air_quality')
    .action((opts) => {
      if (opts.keysOnly) return out([...POINT_MODELS]);
      const s = loadSession();
      const isPremium = s.subscription === 'premium';
      let rows = MODEL_CATALOG;
      if (opts.scope) rows = rows.filter((r) => r.scope === opts.scope);
      if (opts.domain) rows = rows.filter((r) => r.domain === opts.domain);
      const table = rows.map((r) => ({
        key: r.key,
        name: r.name,
        provider: r.provider,
        res_km: r.resKm,
        forecast_h: r.forecastHours,
        free_refresh_min: r.freeIntervalMin,
        premium_refresh_min: r.premiumIntervalMin ?? '—',
        your_refresh_min: isPremium ? (r.premiumIntervalMin ?? r.freeIntervalMin) : r.freeIntervalMin,
        speedup: r.premiumIntervalMin
          ? `${(r.freeIntervalMin / r.premiumIntervalMin).toFixed(1)}x`
          : '—',
        scope: r.scope,
        domain: r.domain,
      }));
      out({
        yourTier: isPremium ? 'premium' : 'free',
        premiumFeatures: PREMIUM_FEATURES,
        models: table,
      });
    });

  forecast
    .command('manifest [model]')
    .description("Model availability manifest (refTimes etc.). Default 'ecmwf-hres'.")
    .option('--no-premium', 'request the non-premium manifest')
    .action((model, opts) =>
      withClient((c) => c.modelManifest(model ?? 'ecmwf-hres', opts.premium)),
    );

  forecast
    .command('sounding <lat,lon>')
    .description(
      'Pressure-level sounding (skew-T data) for 17 atmospheric levels (`surface`..`10h`). ' +
        'Pivoted from the meteogram response: each timestep has temp/dewpoint/rh/gh/wind at each level.',
    )
    .option('-m, --model <name>', 'forecast model', 'ecmwf')
    .option('--ref-time <iso>', 'override model reference time')
    .option('--step <hours>', 'sample interval')
    .option('--at <hour-offset>', 'extract only the given forecast hour (integer ≥ 0)')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        const s = await c.sounding(lat, lon, {
          model: opts.model,
          refTime: opts.refTime,
          step: opts.step ? Number(opts.step) : undefined,
        });
        if (opts.at !== undefined) {
          const idx = Number(opts.at);
          const ts = s.timesteps.find((t) => t.hoursOffset === idx) ?? s.timesteps[0];
          return { ...s, timesteps: [ts] };
        }
        return s;
      }),
    );

  // ── Reference data (no API call) ─────────────────────────────────────────

  program
    .command('overlays')
    .description('List all 66 renderable weather overlays.')
    .action(() => out([...OVERLAYS]));

  program
    .command('levels')
    .description('List the 17 atmospheric levels with their altitudes and flight levels.')
    .action(() =>
      out(
        (LEVELS as readonly (keyof typeof LEVEL_ALTITUDE)[]).map((l) => ({
          level: l,
          ...LEVEL_ALTITUDE[l],
        })),
      ),
    );

  program
    .command('basemaps')
    .description('List supported basemap styles.')
    .action(() => out([...BASEMAP_STYLES]));

  program
    .command('languages')
    .description('List supported UI / label languages.')
    .action(() => out([...SUPPORTED_LANGUAGES]));

  // ── Tile URL builders ────────────────────────────────────────────────────

  const tile = program.command('tile').description('Tile URL builders (no API call).');

  tile
    .command('data <model> <run> <forecastHour> <overlay> <z> <x> <y>')
    .description(
      'Build a URL for a pre-rendered weather data tile on ims.windy.com. ' +
        'Run/forecastHour are YYYYMMDDHH. Get valid values from `windy radar info` or `windy forecast manifest`.',
    )
    .option('--ext <kind>', 'jpg|png', 'jpg')
    .action((model, run, hour, overlay, z, x, y, opts) => {
      const c = WindyClient.fromEnv();
      out(c.dataTileUrl(model, run, hour, overlay, Number(z), Number(x), Number(y), opts.ext));
    });

  tile
    .command('basemap <style> <z> <x> <y>')
    .description('Build a URL for a basemap tile.')
    .action((style, z, x, y) => {
      const c = WindyClient.fromEnv();
      out(c.basemapTileUrl(style as BasemapStyle, Number(z), Number(x), Number(y)));
    });

  tile
    .command('labels <z> <x> <y>')
    .description('Build a URL for a place-label tile (vector JSON).')
    .option('--lang <code>', 'language override')
    .action((z, x, y, opts) => {
      const c = WindyClient.fromEnv();
      out(c.labelTileUrl(Number(z), Number(x), Number(y), opts.lang));
    });

  // ── Search / location ────────────────────────────────────────────────────

  program
    .command('search <query>')
    .description('Location search biased to a coordinate.')
    .requiredOption('--near <lat,lon>', 'bias coordinate')
    .option('--size <n>', 'max results (min 10)', '13')
    .action((query, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(opts.near);
        return c.search(query, lat, lon, Number(opts.size));
      }),
    );

  program
    .command('reverse <lat,lon>')
    .description('Reverse geocode a coordinate.')
    .option('--zoom <n>', 'detail level (10=city, 14=neighbourhood)', '14')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.reverseGeocode(lat, lon, Number(opts.zoom));
      }),
    );

  program
    .command('elevation <lat,lon>')
    .description('Elevation in meters at a coordinate.')
    .action((latlon) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.elevation(lat, lon);
      }),
    );

  program
    .command('timezone <lat,lon>')
    .description('Timezone info for a coordinate.')
    .option('--ts <ms>', 'unix-ms instant (default: now)')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.timezone(lat, lon, opts.ts ? Number(opts.ts) : Date.now());
      }),
    );

  // ── Stations / Air quality / POIs ────────────────────────────────────────

  const stations = program.command('stations').description('Weather station endpoints.');

  stations
    .command('near <lat,lon>')
    .description('Nearby weather stations (airport METAR, WMO, PWS, MADIS).')
    .action((latlon) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.nearbyStations(lat, lon);
      }),
    );

  stations
    .command('observations <type> <id>')
    .description(
      'Historical observations for a station. type=airq|ad|wmo|pws|madis. id without prefix.',
    )
    .option('--days <n>', 'look-back window (1, 3, 7, 10, 30)', '10')
    .option('--step <hours>', 'hours per sample', '1')
    .action((type, id, opts) =>
      withClient((c) =>
        c.observations(
          type as 'airq' | 'ad' | 'wmo' | 'pws' | 'madis',
          id,
          Number(opts.days),
          Number(opts.step),
        ),
      ),
    );

  const airq = program.command('airq').description('Air-quality endpoints.');

  airq
    .command('near <lat,lon>')
    .description('Nearby air-quality stations.')
    .action((latlon) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.nearbyAirQuality(lat, lon);
      }),
    );

  airq
    .command('station <id>')
    .description('Air-quality station detail (latest measurement).')
    .action((id) => withClient((c) => c.airQualityStation(id)));

  program
    .command('poi <type> <id>')
    .description("Generic POI detail by type + id (e.g. 'stations ad-LLBG').")
    .action((type, id) => withClient((c) => c.poiDetail(type, id)));

  // ── Tides ────────────────────────────────────────────────────────────────

  const tides = program.command('tides').description('Tide forecast endpoints.');
  tides
    .command('at <lat,lon>')
    .description('Tide forecast for nearest port.')
    .action((latlon) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.tides(lat, lon);
      }),
    );
  tides
    .command('near <lat,lon>')
    .description('Nearby tide stations.')
    .action((latlon) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.nearbyTides(lat, lon);
      }),
    );

  // ── Alerts ───────────────────────────────────────────────────────────────

  const alerts = program.command('alerts').description('Weather alerts.');
  alerts
    .command('cap <lat,lon>')
    .description('Government-issued severe weather alerts (CAP).')
    .option('--max <n>', 'max alerts', '6')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.capAlerts(lat, lon, { maxCount: Number(opts.max) });
      }),
    );
  alerts
    .command('live <lat,lon>')
    .description('Live alerts subscribed by current user.')
    .addOption(new Option('--distance <u>').choices(['km', 'mi']).default('km'))
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.liveAlerts(lat, lon, opts.distance);
      }),
    );
  alerts
    .command('user')
    .description('List user-defined alerts (requires login).')
    .action(() => withClient((c) => c.userAlerts()));

  // ── Storms ───────────────────────────────────────────────────────────────

  const storms = program.command('storms').description('Tropical cyclone tracker.');
  storms.command('list').description('Active tropical storms worldwide.').action(() =>
    withClient((c) => c.storms()),
  );
  storms.command('count').description('Active storms count.').action(() =>
    withClient((c) => c.stormsCount()),
  );

  // ── Webcams ──────────────────────────────────────────────────────────────

  const webcams = program.command('webcams').description('Live webcam endpoints.');
  webcams
    .command('near <lat,lon>')
    .description('Webcams near a coordinate.')
    .option('--limit <n>', 'max results')
    .addOption(
      new Option('--size <kind>', 'image size')
        .choices(['thumbnail', 'preview', 'original'])
        .default('thumbnail'),
    )
    .action((latlon, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.webcamsNear(lat, lon, {
          limit: opts.limit ? Number(opts.limit) : undefined,
          imageSize: opts.size,
        });
      }),
    );
  webcams
    .command('detail <id>')
    .description('Webcam detail.')
    .addOption(
      new Option('--size <kind>')
        .choices(['thumbnail', 'preview', 'original'])
        .default('preview'),
    )
    .action((id, opts) =>
      withClient((c) => c.webcamDetail(id, opts.size)),
    );
  webcams
    .command('archive <id>')
    .description('Webcam archive frame list.')
    .option('--size <kind>')
    .option('--type <kind>')
    .action((id, opts) =>
      withClient((c) =>
        c.webcamArchive(id, { imageSize: opts.size, archiveType: opts.type }),
      ),
    );
  webcams
    .command('search <query>')
    .description('Text-search across all webcams.')
    .option('--near <lat,lon>', 'optional bias coordinate')
    .action((query, opts) =>
      withClient((c) => {
        const bias = opts.near ? parseLatLon(opts.near) : null;
        return c.webcamSearch(query, bias ? { lat: bias[0], lon: bias[1] } : {});
      }),
    );
  webcams
    .command('ping <id>')
    .description('Webcam health/ping metrics.')
    .action((id) => withClient((c) => c.webcamPing(id)));
  webcams
    .command('mine')
    .description('List webcams owned by the current user (requires login).')
    .action(() => withClient((c) => c.myWebcams()));
  webcams
    .command('register')
    .description('Register a new webcam (owner flow, requires login).')
    .requiredOption('--title <s>')
    .requiredOption('--at <lat,lon>')
    .requiredOption('--image-url <url>')
    .option('--source-url <url>', 'public webcam page')
    .option('--description <s>')
    .action((opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(opts.at);
        return c.addWebcam({
          title: opts.title,
          lat,
          lon,
          imageUrl: opts.imageUrl,
          sourceUrl: opts.sourceUrl,
          description: opts.description,
        });
      }),
    );
  webcams
    .command('remove <id>')
    .description('Remove an owned webcam.')
    .action((id) => withClient((c) => c.removeWebcam(id)));

  // ── Push notifications ───────────────────────────────────────────────────

  const push = program.command('push').description('Push notification device registration.');
  push
    .command('register <token>')
    .description('Register an FCM/APNs push token for this device.')
    .addOption(
      new Option('--platform <kind>').choices(['web', 'ios', 'android']).default('web'),
    )
    .action((token, opts) =>
      withClient((c) => c.registerPushDevice(token, opts.platform)),
    );
  push
    .command('unregister')
    .description('Remove this device from push notifications.')
    .action(() => withClient((c) => c.unregisterPushDevice()));

  // ── api.windy.com (public, commercial API) ───────────────────────────────

  const api = program
    .command('api')
    .description('Calls to api.windy.com — the official commercial API. Requires a separate API key from https://api.windy.com/.');

  api
    .command('point <lat,lon>')
    .description("Point Forecast via api.windy.com (uses WINDY_API_KEY env var).")
    .requiredOption('-m, --model <name>', 'model (gfs, ecmwf, iconEu, ...)')
    .requiredOption(
      '-p, --parameters <list>',
      "comma-separated, e.g. 'wind,temp,rh,pressure'",
    )
    .option('--levels <list>', "comma-separated, e.g. 'surface,850h,500h'")
    .option('--key <apiKey>', 'override WINDY_API_KEY')
    .action((latlon, opts) =>
      withClient(async (c) => {
        const apiKey = opts.key ?? process.env.WINDY_API_KEY;
        if (!apiKey) die('WINDY_API_KEY env var or --key flag required for api.windy.com');
        const [lat, lon] = parseLatLon(latlon);
        const parameters = String(opts.parameters).split(',').map((s) => s.trim());
        const levels = opts.levels
          ? String(opts.levels).split(',').map((s) => s.trim() as (typeof LEVELS)[number])
          : undefined;
        return c.apiPointForecast(apiKey, {
          lat,
          lon,
          model: opts.model,
          parameters,
          levels,
        });
      }),
    );

  // ── Airport ──────────────────────────────────────────────────────────────

  program
    .command('airport <icao>')
    .description('Airport info, runways, METAR (e.g., LLBG, KJFK, EGLL).')
    .action((icao) => withClient((c) => c.airport(icao)));

  // ── Citytile ─────────────────────────────────────────────────────────────

  program
    .command('citytile <model> <z> <x> <y>')
    .description('City overlay tile (per-city forecast pills).')
    .option('--ref-time <iso>', 'override model reference time')
    .option('--step <h>', 'sample interval in hours', '3')
    .option('--hours <n>', 'forecast horizon hours')
    .action((model, z, x, y, opts) =>
      withClient((c) =>
        c.citytile(model, Number(z), Number(x), Number(y), {
          refTime: opts.refTime,
          step: Number(opts.step),
          hours: opts.hours ? Number(opts.hours) : undefined,
        }),
      ),
    );

  // ── Radar / satellite ────────────────────────────────────────────────────

  const radar = program.command('radar').description('Radar / satellite imagery.');
  radar.command('info').description('Radar composite metadata.').action(() =>
    withClient((c) => c.radarInfo()),
  );
  radar.command('coverage').description('Radar coverage polygon.').action(() =>
    withClient((c) => c.radarCoverage()),
  );
  radar.command('archive').description('Radar archive frame index.').action(() =>
    withClient((c) => c.radarArchive()),
  );
  radar.command('satellite').description('Satellite composite metadata.').action(() =>
    withClient((c) => c.satelliteInfo()),
  );
  radar.command('satellite-archive').description('Satellite archive frame range.').action(() =>
    withClient((c) => c.satelliteArchive()),
  );
  radar
    .command('image-url <type> <lat,lon>')
    .description('URL to a pre-rendered radar|satellite widget image.')
    .option('-w <px>', 'width', '640')
    .option('-h <px>', 'height', '360')
    .option('--format <fmt>', 'image format', 'jpeg')
    .option('--mode <m>', 'rendering mode')
    .action((type, latlon, opts) => {
      const c = WindyClient.fromEnv();
      const [lat, lon] = parseLatLon(latlon);
      out(
        c.widgetImageUrl(type as 'radar' | 'satellite', lat, lon, {
          w: Number(opts.w),
          h: Number(opts.h),
          format: opts.format,
          mode: opts.mode,
        }),
      );
    });

  program
    .command('static-map <lat,lon>')
    .description('URL to a pre-rendered static map image.')
    .option('--zoom <n>', 'map zoom (0-19)', '10')
    .option('--size <px>', 'image edge size', '640')
    .action((latlon, opts) => {
      const c = WindyClient.fromEnv();
      const [lat, lon] = parseLatLon(latlon);
      out(c.staticMapUrl({ lat, lon, zoom: Number(opts.zoom), size: Number(opts.size) }));
    });

  // ── Favourites / user data ───────────────────────────────────────────────

  const favs = program.command('favs').description('User favourites (requires login).');
  favs.command('list').description('List favourites.').action(() =>
    withClient((c) => c.favourites()),
  );
  favs
    .command('add <lat,lon> <title>')
    .description('Add a new favourite.')
    .option('--note <text>', 'note attached to the favourite')
    .option('--cc <code>', 'ISO country code')
    .option('--pin', 'pin this favourite', false)
    .action((latlon, title, opts) =>
      withClient(async (c) => {
        const [lat, lon] = parseLatLon(latlon);
        return c.addFavourite({
          lat,
          lon,
          title,
          note: opts.note,
          cc: opts.cc,
          pin: opts.pin,
          key: `${lat.toFixed(3)}/${lon.toFixed(3)}`,
        } as Parameters<typeof c.addFavourite>[0]);
      }),
    );
  favs
    .command('delete <id>')
    .description('Delete a favourite by id.')
    .action((id) => withClient((c) => c.deleteFavourite(id)));

  const userAlerts = program.command('user-alerts').description('User alerts CRUD (requires login).');
  userAlerts.command('list').description('List user alerts.').action(() =>
    withClient((c) => c.userAlerts()),
  );
  userAlerts.command('get <id>').description('Get user alert by id.').action((id) =>
    withClient((c) => c.getUserAlert(id)),
  );
  userAlerts.command('delete <id>').description('Delete a user alert.').action((id) =>
    withClient((c) => c.deleteUserAlert(id)),
  );

  program
    .command('settings')
    .description('User settings (requires login).')
    .action(() => withClient((c) => c.userSettings()));
  program
    .command('colors')
    .description('Custom color palettes (requires login).')
    .action(() => withClient((c) => c.userColors()));
  program
    .command('plugins')
    .description('Installed plugin list (requires login).')
    .action(() => withClient((c) => c.userPlugins()));
  program
    .command('device')
    .description('Device registration (requires login).')
    .action(() => withClient((c) => c.userDevice()));

  // ── Articles / promos ────────────────────────────────────────────────────

  const articles = program.command('articles').description('Startup banner content.');
  articles
    .command('article')
    .description('Startup article banner.')
    .option('--lat <n>')
    .option('--lon <n>')
    .action((opts) =>
      withClient((c) =>
        c.startupArticle({
          lat: opts.lat ? Number(opts.lat) : undefined,
          lon: opts.lon ? Number(opts.lon) : undefined,
        }),
      ),
    );
  articles
    .command('promo')
    .description('Startup marketing promo.')
    .option('--lat <n>')
    .option('--lon <n>')
    .option('--force-id <id>')
    .action((opts) =>
      withClient((c) =>
        c.startupPromo({
          lat: opts.lat ? Number(opts.lat) : undefined,
          lon: opts.lon ? Number(opts.lon) : undefined,
          forceId: opts.forceId,
        }),
      ),
    );

  return program;
}

if (require.main === module) {
  buildProgram().parseAsync(process.argv);
}
