import https from 'https';
import { URL } from 'url';
import { createGunzip, createBrotliDecompress, createInflate } from 'zlib';
import type {
  AccountInfo,
  AirQualityPOI,
  CapAlert,
  Favourite,
  LiveAlertsResponse,
  NearbyAirQualityStation,
  NearbyWeatherStation,
  ObservationTimeseries,
  PointForecast,
  ReverseGeocode,
  SearchResponse,
  StormsResponse,
  TideForecast,
  UserAlert,
  Webcam,
  WebcamList,
  PointModel,
  AirQualityModel,
  StationType,
} from './types';
import {
  decodeJWT,
  loadSession,
  saveSession,
  tokenIsStale,
  type PersistedSession,
} from './session';

const APP_VERSION = '50.0.3';
const APP_ACCEPT_HEADER = 'application/json binary/hcacaf$indf4a2';

const NODE_HOST = 'node.windy.com';
const ACCOUNT_HOST = 'account.windy.com';
const NODE_S_HOST = 'node-s.windy.com';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Set to `false` to skip auth params and the bootstrap. */
  auth?: boolean;
  /** Override host (default `node.windy.com`). */
  host?: string;
  /** Extra query params (appended after the auth envelope). */
  qs?: Record<string, string | number | boolean | undefined>;
  /** Send Authorization: Bearer header (auth must be enabled). */
  bearer?: boolean;
  /** Raw response (don't JSON.parse). Returns text body. */
  raw?: boolean;
  /** Skip the auth envelope (`token2`, `uid`, `v`, `poc`, `pr`, `sc`) but still send `_account_sid` cookie if available. */
  skipEnvelope?: boolean;
}

export interface ClientOptions {
  /** Override the session file. If not provided, persists to ~/.config/windy-cli/session.json. */
  session?: PersistedSession;
  /** Country code (ISO 3166-1 alpha-2 lowercase). Default `xx`. */
  country?: string;
  /** Language (ISO 639-1). Default `en`. */
  lang?: string;
  /** Don't persist updates to disk. */
  ephemeral?: boolean;
}

export class WindyClient {
  private session: PersistedSession;
  private country: string;
  private lang: string;
  private ephemeral: boolean;
  private pocCounter = 1;
  private refreshPromise: Promise<void> | null = null;

  constructor(opts: ClientOptions = {}) {
    this.session = opts.session ?? loadSession();
    this.country = opts.country ?? 'xx';
    this.lang = opts.lang ?? 'en';
    this.ephemeral = opts.ephemeral ?? false;
  }

  /** Build a client from environment variables and/or the on-disk session. */
  static fromEnv(opts: Omit<ClientOptions, 'session'> = {}): WindyClient {
    const session = loadSession();
    if (process.env.WINDY_ACCOUNT_SID) session.accountSid = process.env.WINDY_ACCOUNT_SID;
    if (process.env.WINDY_TOKEN) {
      session.token = process.env.WINDY_TOKEN;
      try {
        const claims = decodeJWT(process.env.WINDY_TOKEN);
        session.tokenExp = claims.exp;
        if (claims.userID) session.userId = claims.userID;
      } catch {
        /* ignore */
      }
    }
    if (process.env.WINDY_UID) session.uid = process.env.WINDY_UID;
    return new WindyClient({ ...opts, session });
  }

  get persistedSession(): PersistedSession {
    return { ...this.session };
  }

  // ── Authentication ────────────────────────────────────────────────────

  /**
   * Fetch a fresh JWT and user info from /api/info.
   *
   * If `_account_sid` cookie is set, the server returns a logged-in JWT.
   * Otherwise an anonymous JWT (still usable for most public endpoints).
   */
  async refreshAuth(): Promise<AccountInfo> {
    // Bypass ensureAuth() to avoid recursion — the /api/info call IS the refresh.
    const info = await this.requestNoEnsure<AccountInfo>('/api/info', {
      host: ACCOUNT_HOST,
      skipEnvelope: false,
      bearer: !!this.session.token,
    });
    // Only persist the new token when the response is for an authenticated session.
    // (Without _account_sid the server returns an anonymous JWT — saving it would
    // clobber a user-supplied authenticated token.)
    const isAuthedResponse = info?.auth === true && !!info?.userInfo;
    if (info?.token && isAuthedResponse) {
      this.session.token = info.token;
      try {
        const claims = decodeJWT(info.token);
        this.session.tokenExp = claims.exp;
        if (claims.userID) this.session.userId = claims.userID;
      } catch {
        /* ignore */
      }
    }
    if (info?.userInfo) {
      this.session.username = info.userInfo.username;
    }
    if (info?.subscription) {
      this.session.subscription = info.subscription;
    }
    if (isAuthedResponse) this.persist();
    return info;
  }

  /** Returns current user info / subscription. */
  async whoami(): Promise<AccountInfo> {
    return this.refreshAuth();
  }

  /** Decode the active JWT (does not refresh). */
  decodeToken() {
    if (!this.session.token) return null;
    try {
      return decodeJWT(this.session.token);
    } catch {
      return null;
    }
  }

  // ── Forecast ───────────────────────────────────────────────────────────

  /**
   * Multi-day point forecast.
   * @param model One of POINT_MODELS, e.g. `ecmwf`, `gfs`, `icon`.
   * @param refTime Optional ISO model-run timestamp. Omit to use latest.
   * @param setup `summary` returns daily aggregates; omit for full hourly.
   */
  async pointForecast(
    lat: number,
    lon: number,
    opts: {
      model?: PointModel | string;
      refTime?: string;
      setup?: 'summary' | undefined;
      includeNow?: boolean;
      step?: number;
      interpolate?: boolean;
      extended?: boolean;
      source?: string;
    } = {},
  ): Promise<PointForecast> {
    const model = opts.model ?? 'ecmwf';
    return this.request<PointForecast>(
      `/forecast/point/${model}/v2.9/${fmt(lat)}/${fmt(lon)}`,
      {
        qs: {
          refTime: opts.refTime,
          setup: opts.setup,
          includeNow: opts.includeNow,
          step: opts.step,
          interpolate: opts.interpolate ? 'true' : undefined,
          extended: opts.extended ? 'true' : undefined,
          source: opts.source ?? 'hp',
        },
      },
    );
  }

  /** Current-conditions snapshot at a point (single timestep). */
  async pointNow(
    lat: number,
    lon: number,
    opts: { model?: PointModel | string; refTime?: string } = {},
  ): Promise<unknown> {
    const model = opts.model ?? 'ecmwf';
    return this.request(`/forecast/point/now/${model}/v1.0/${fmt(lat)}/${fmt(lon)}`, {
      qs: { refTime: opts.refTime },
    });
  }

  /** Meteogram (hourly multi-param) for a point. */
  async meteogram(
    lat: number,
    lon: number,
    opts: { model?: PointModel | string; refTime?: string; step?: number } = {},
  ): Promise<unknown> {
    const model = opts.model ?? 'ecmwf';
    return this.request(`/forecast/meteogram/${model}/v1.2/${fmt(lat)}/${fmt(lon)}`, {
      qs: { refTime: opts.refTime, step: opts.step },
    });
  }

  /** Air-quality forecast at a point (CAMS or CAMS-Europe). */
  async airQualityForecast(
    lat: number,
    lon: number,
    opts: { model?: AirQualityModel; refTime?: string } = {},
  ): Promise<unknown> {
    const model = opts.model ?? 'cams';
    return this.request(`/forecast/airq/${model}/v1.0/${fmt(lat)}/${fmt(lon)}`, {
      qs: { refTime: opts.refTime },
    });
  }

  /** Forecast model manifest (available reftimes, premium gating). */
  async modelManifest(
    model: string = 'ecmwf-hres',
    premium = true,
  ): Promise<unknown> {
    return this.request(`/metadata/v1.0/forecast/${model}/minifest.json`, {
      qs: { premium: premium ? 'true' : undefined },
    });
  }

  // ── Search / geocoding ─────────────────────────────────────────────────

  /**
   * Location search biased to a coordinate.
   * @param query Free-text query
   * @param biasLat,biasLon Bias point (results closer ranked higher)
   * @param size Max results (default 13)
   */
  async search(
    query: string,
    biasLat: number,
    biasLon: number,
    size = 13,
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>(
      `/search/v4.1/${fmt(biasLat)}/${fmt(biasLon)}/${encodeURIComponent(query)}`,
      { qs: { lang: this.lang, size } },
    );
  }

  /** Reverse geocode a coordinate. Zoom 14 ≈ neighborhood, 10 ≈ city. */
  async reverseGeocode(lat: number, lon: number, zoom = 14): Promise<ReverseGeocode> {
    return this.request<ReverseGeocode>(
      `/reverse/v3/${fmt(lat)}/${fmt(lon)}/${zoom}`,
      { qs: { lang: this.lang } },
    );
  }

  /** Elevation in meters at a coordinate (returns bare number from server). */
  async elevation(lat: number, lon: number): Promise<number> {
    return this.request<number>(`/services/elevation/${fmt(lat)}/${fmt(lon)}`);
  }

  /** Timezone info for a coordinate at an instant. */
  async timezone(lat: number, lon: number, ts: number = Date.now()): Promise<unknown> {
    return this.request(`/services/v1/timezone/${fmt(lat)}/${fmt(lon)}`, {
      qs: { ts },
    });
  }

  // ── POIs ───────────────────────────────────────────────────────────────

  /** Nearby air-quality stations. */
  async nearbyAirQuality(lat: number, lon: number): Promise<NearbyAirQualityStation[]> {
    return this.request<NearbyAirQualityStation[]>(
      `/pois/v2/airq/${fmt(lat)}/${fmt(lon)}`,
    );
  }

  /** Nearby weather stations (airport METAR + WMO + PWS + MADIS). */
  async nearbyStations(lat: number, lon: number): Promise<NearbyWeatherStation[]> {
    return this.request<NearbyWeatherStation[]>(
      `/pois/v2/stations/${fmt(lat)}/${fmt(lon)}`,
    );
  }

  /** Nearby tide stations. */
  async nearbyTides(lat: number, lon: number): Promise<unknown> {
    return this.request(`/pois/v2/tides/${fmt(lat)}/${fmt(lon)}`);
  }

  /** Air-quality POI detail (latest measurement). */
  async airQualityStation(id: string): Promise<AirQualityPOI> {
    const fullId = id.startsWith('airq-') ? id : `airq-${id}`;
    return this.request<AirQualityPOI>(`/pois/v2/airq/${fullId}`);
  }

  /** Generic POI detail by `{type}-{id}`. */
  async poiDetail<T = unknown>(type: string, id: string): Promise<T> {
    return this.request<T>(`/pois/v2/${type}/${id}`);
  }

  /**
   * Historical observation timeseries for a station.
   * @param type `airq` | `ad` | `wmo` | `pws` | `madis`
   * @param id Station id (without the `{type}-` prefix)
   * @param days Look-back window (1, 3, 7, 10, 30)
   * @param step Hours per sample (1 = hourly, 3 = 3-hourly, 24 = daily)
   */
  async observations(
    type: StationType | 'airq',
    id: string,
    days = 10,
    step = 1,
  ): Promise<ObservationTimeseries> {
    const bareId = id.replace(/^(airq|ad|wmo|pws|madis)-/, '');
    return this.request<ObservationTimeseries>(
      `/obs/measurement/v3/${type}/${bareId}/${days}/${step}`,
    );
  }

  // ── Tides ──────────────────────────────────────────────────────────────

  /** Tide forecast for nearest port to a coordinate. */
  async tides(lat: number, lon: number): Promise<TideForecast> {
    return this.request<TideForecast>(`/tides/v1.0/tides/${fmt(lat)}/${fmt(lon)}`);
  }

  /** Tide forecast by tide-POI id. */
  async tidesByPoi(poiId: string): Promise<TideForecast> {
    return this.request<TideForecast>(`/tides/v1.0/tides/${poiId}`);
  }

  // ── Alerts ─────────────────────────────────────────────────────────────

  /** Public CAP (government-issued severe weather) alerts at a location. */
  async capAlerts(
    lat: number,
    lon: number,
    opts: { maxCount?: number; source?: string } = {},
  ): Promise<CapAlert[] | null> {
    return this.request<CapAlert[] | null>(`/capalerts/${fmt(lat)}/${fmt(lon)}`, {
      qs: {
        source: opts.source ?? 'hp',
        lang: this.lang,
        maxCount: opts.maxCount ?? 6,
      },
    });
  }

  /** Live alerts subscribed by the current user. */
  async liveAlerts(
    lat: number,
    lon: number,
    distance: 'km' | 'mi' = 'km',
  ): Promise<LiveAlertsResponse> {
    return this.request<LiveAlertsResponse>(`/notif/v1/live-alerts/${fmt(lat)}/${fmt(lon)}`, {
      qs: { distance, userLanguage: this.lang },
    });
  }

  // ── Tropical cyclones ──────────────────────────────────────────────────

  /** Active tropical storms worldwide. */
  async storms(): Promise<StormsResponse> {
    return this.request<StormsResponse>('/tc/v2/storms');
  }

  /** Number of active storms. */
  async stormsCount(): Promise<unknown> {
    return this.request('/tc/v2/storms/active/count');
  }

  // ── Webcams ────────────────────────────────────────────────────────────

  /** Webcams near a coordinate. */
  async webcamsNear(
    lat: number,
    lon: number,
    opts: { limit?: number; imageSize?: 'thumbnail' | 'preview' | 'original' } = {},
  ): Promise<WebcamList> {
    return this.request<WebcamList>('/webcams/v2.0/list', {
      qs: {
        nearby: `${fmt(lat)},${fmt(lon)}`,
        lang: this.lang,
        limit: opts.limit,
        imageSize: opts.imageSize ?? 'thumbnail',
      },
    });
  }

  /** Webcam detail. */
  async webcamDetail(
    id: number | string,
    imageSize: 'thumbnail' | 'preview' | 'original' = 'preview',
  ): Promise<Webcam> {
    return this.request<Webcam>(`/webcams/v2.0/detail/${id}`, {
      qs: { imageSize, lang: this.lang },
    });
  }

  /** Webcam archive frame list. */
  async webcamArchive(
    id: number | string,
    opts: { imageSize?: string; archiveType?: string } = {},
  ): Promise<unknown> {
    return this.request(`/webcams/v3.0/archive/${id}`, {
      qs: { imageSize: opts.imageSize, archiveType: opts.archiveType },
    });
  }

  /** Webcam hourly archive. */
  async webcamHourlyArchive(id: number | string): Promise<unknown> {
    return this.request(`/webcams/v2.0/archive/hourly/${id}`);
  }

  // ── Radar / satellite ──────────────────────────────────────────────────

  async radarInfo(): Promise<unknown> {
    return this.request('https://rdr.windy.com/radar2/composite/minifest2.json', {
      auth: false,
      skipEnvelope: true,
    });
  }

  async radarCoverage(): Promise<unknown> {
    return this.request('https://rdr.windy.com/radar2/composite/coverage.json', {
      auth: false,
      skipEnvelope: true,
    });
  }

  async satelliteInfo(): Promise<unknown> {
    return this.request('https://sat.windy.com/satellite/composite.json', {
      auth: false,
      skipEnvelope: true,
    });
  }

  /** URL of a pre-rendered radar/satellite widget image. */
  widgetImageUrl(
    type: 'radar' | 'satellite',
    lat: number,
    lon: number,
    opts: { w?: number; h?: number; format?: string; mode?: string } = {},
  ): string {
    const mode = opts.mode ?? (type === 'satellite' ? 'blue' : 'default');
    const params = new URLSearchParams({
      lat: fmt(lat),
      lon: fmt(lon),
      w: String(opts.w ?? 640),
      h: String(opts.h ?? 360),
      format: opts.format ?? 'jpeg',
    });
    return `https://${NODE_HOST}/widget/${type}/${mode}/image?${params}`;
  }

  /** URL of a static map image (used in share previews). */
  staticMapUrl(opts: {
    lat: number;
    lon: number;
    zoom?: number;
    size?: number;
  }): string {
    const params = new URLSearchParams({
      c: `${fmt(opts.lat)},${fmt(opts.lon)}`,
      z: String(opts.zoom ?? 10),
      size: String(opts.size ?? 640),
    });
    return `https://${NODE_S_HOST}/imaker/map?${params}`;
  }

  // ── User data (require login) ──────────────────────────────────────────

  /** List user favourites. */
  async favourites(): Promise<Favourite[]> {
    return this.requireAuthed('favourites'), this.request<Favourite[]>('/users/v1/data/favs');
  }

  async putFavourite(fav: Favourite): Promise<unknown> {
    this.requireAuthed('putFavourite');
    if (!fav.id) throw new Error('Favourite.id is required for PUT');
    return this.request(`/users/v1/data/favs/${fav.id}`, {
      method: 'PUT',
      body: fav,
    });
  }

  async deleteFavourite(key: string): Promise<unknown> {
    this.requireAuthed('deleteFavourite');
    return this.request(`/users/v1/data/favs/${key}`, { method: 'DELETE' });
  }

  /** List user alerts. */
  async userAlerts(): Promise<UserAlert[]> {
    this.requireAuthed('userAlerts');
    return this.request<UserAlert[]>('/users/v1/data/alerts');
  }

  /** Get user settings. */
  async userSettings(): Promise<unknown> {
    this.requireAuthed('userSettings');
    return this.request('/users/settings');
  }

  // ── Misc ───────────────────────────────────────────────────────────────

  /** Startup banner article. */
  async startupArticle(opts: { lat?: number; lon?: number } = {}): Promise<unknown> {
    return this.request('/articles/startup/article', {
      qs: {
        country: this.country,
        device: 'desktop',
        language: this.lang,
        platform: 'desktop',
        target: 'index',
        userStatus: this.session.subscription === 'premium' ? 'premium' : 'free',
        loginStatus: this.session.userId ? 'signed-in' : 'signed-out',
        version: APP_VERSION,
        lat: opts.lat,
        lon: opts.lon,
      },
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private requireAuthed(op: string): void {
    if (!this.session.accountSid && !this.session.token) {
      throw new Error(
        `${op} requires an authenticated session. Run \`windy login --cookie <_account_sid>\` first.`,
      );
    }
  }

  private persist(): void {
    if (!this.ephemeral) saveSession(this.session);
  }

  private async ensureAuth(): Promise<void> {
    // Only refresh when we have a means to refresh (account cookie) and the token is stale
    if (!tokenIsStale(this.session, 60)) return;
    if (!this.session.accountSid && this.session.token) {
      // Token given via env without cookie — can't refresh, hope it's still valid
      return;
    }
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        await this.refreshAuth();
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private async request<T = unknown>(
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    if (auth) await this.ensureAuth();
    return this.requestNoEnsure<T>(pathOrUrl, options);
  }

  private async requestNoEnsure<T = unknown>(
    pathOrUrl: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const skipEnvelope = options.skipEnvelope ?? false;

    const isAbsolute = pathOrUrl.startsWith('http');
    const base = isAbsolute ? pathOrUrl : `https://${options.host ?? NODE_HOST}${pathOrUrl}`;
    const url = new URL(base);

    // Merge user qs first, then auth envelope (envelope overrides if collision)
    if (options.qs) {
      for (const [k, v] of Object.entries(options.qs)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    if (!skipEnvelope) {
      const tiers = this.decodeToken()?.subscriptionTiers ?? [];
      const isPremium = tiers.includes('premium') || this.session.subscription === 'premium';
      url.searchParams.set('pr', isPremium ? '1' : '0');
      url.searchParams.set('sc', isPremium ? '1' : '0');
      if (this.session.token) url.searchParams.set('token2', this.session.token);
      url.searchParams.set('uid', this.session.uid);
      url.searchParams.set('v', APP_VERSION);
      url.searchParams.set('poc', String(this.pocCounter++));
    }

    return this.rawRequest<T>(url, options);
  }

  private rawRequest<T>(url: URL, options: RequestOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      const method = options.method ?? 'GET';
      const data =
        options.body !== undefined ? JSON.stringify(options.body) : undefined;
      const headers: Record<string, string> = {
        accept: APP_ACCEPT_HEADER,
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': `${this.lang}-US,${this.lang};q=0.9`,
        'user-agent': USER_AGENT,
        origin: 'https://www.windy.com',
        referer: 'https://www.windy.com/',
      };
      if (this.session.accountSid && url.hostname.endsWith('windy.com')) {
        headers['cookie'] = `_account_sid=${this.session.accountSid}`;
      }
      if (options.bearer && this.session.token) {
        headers['authorization'] = `Bearer ${this.session.token}`;
      }
      if (data !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(data));
      }

      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          headers,
          timeout: Number(process.env.WINDY_HTTP_TIMEOUT ?? 30000),
        },
        (res) => {
          let stream: NodeJS.ReadableStream = res;
          const encoding = res.headers['content-encoding'];
          if (encoding === 'gzip') stream = res.pipe(createGunzip());
          else if (encoding === 'br') stream = res.pipe(createBrotliDecompress());
          else if (encoding === 'deflate') stream = res.pipe(createInflate());
          else if (encoding === 'zstd') {
            try {
              // zstd was added to zlib in Node 22.15+. Older versions will fall through.
              const zlib = require('zlib') as typeof import('zlib');
              const decoder = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream })
                .createZstdDecompress?.();
              if (decoder) stream = res.pipe(decoder);
            } catch {
              /* fall through to raw — likely garbage */
            }
          }

          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            const text = buf.toString();
            const status = res.statusCode ?? 0;

            if (status === 204 || buf.length === 0) {
              resolve(null as T);
              return;
            }
            if (status >= 400) {
              reject(
                new WindyAPIError(
                  status,
                  `HTTP ${status} on ${url.pathname}: ${text.slice(0, 400)}`,
                  text,
                ),
              );
              return;
            }
            if (options.raw) {
              resolve(text as unknown as T);
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch {
              // Some endpoints return text/plain numbers (e.g. /services/elevation)
              const asNum = Number(text);
              if (!Number.isNaN(asNum) && text.trim() !== '') {
                resolve(asNum as unknown as T);
                return;
              }
              reject(new Error(`Non-JSON response from ${url.pathname}: ${text.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out: ${url.pathname}`));
      });
      if (data !== undefined) req.write(data);
      req.end();
    });
  }
}

export class WindyAPIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'WindyAPIError';
  }
}

function fmt(coord: number): string {
  // Windy expects 3 decimal places for the lat/lon path segments
  return coord.toFixed(3);
}
