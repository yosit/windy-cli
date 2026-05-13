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
import { POINT_MODELS, AIR_QUALITY_MODELS } from './types';

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
    .description('List supported point-forecast model identifiers.')
    .action(() => out([...POINT_MODELS]));

  forecast
    .command('manifest [model]')
    .description("Model availability manifest (refTimes etc.). Default 'ecmwf-hres'.")
    .option('--no-premium', 'request the non-premium manifest')
    .action((model, opts) =>
      withClient((c) => c.modelManifest(model ?? 'ecmwf-hres', opts.premium)),
    );

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

  // ── Radar / satellite ────────────────────────────────────────────────────

  const radar = program.command('radar').description('Radar / satellite imagery.');
  radar.command('info').description('Radar composite metadata.').action(() =>
    withClient((c) => c.radarInfo()),
  );
  radar.command('coverage').description('Radar coverage polygon.').action(() =>
    withClient((c) => c.radarCoverage()),
  );
  radar.command('satellite').description('Satellite composite metadata.').action(() =>
    withClient((c) => c.satelliteInfo()),
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
    .command('delete <key>')
    .description('Delete a favourite by key.')
    .action((key) => withClient((c) => c.deleteFavourite(key)));

  program
    .command('settings')
    .description('User settings (requires login).')
    .action(() => withClient((c) => c.userSettings()));

  return program;
}

if (require.main === module) {
  buildProgram().parseAsync(process.argv);
}
