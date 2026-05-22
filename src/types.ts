/** Windy API entity types. */

// ── Auth ──────────────────────────────────────────────────────────────────

/** Session credentials passed to the client. */
export interface SessionCredentials {
  /** `_account_sid` HttpOnly cookie value (from a logged-in browser). */
  accountSid?: string;
  /** Device UUID stored in localStorage; auto-generated if absent. */
  uid?: string;
  /** Pre-acquired JWT, bypasses the bootstrap call. Auto-refreshed if expired. */
  token?: string;
  /** Country code (ISO 3166-1 alpha-2 lowercase). */
  country?: string;
  /** UI language (ISO 639-1). */
  lang?: string;
}

/** Decoded JWT claims windy issues. */
export interface WindyJWT {
  magic: number;
  userID?: number;
  subscriptionTiers?: string[];
  iat: number;
  exp: number;
}

/** Subset of /api/info response. */
export interface AccountInfo {
  message: string;
  auth: boolean;
  token: string;
  userInfo: {
    avatar: string;
    email: string;
    username: string;
    userslug: string;
    verifiedEmail: string;
    joindate: number;
    fullname: string;
    id: number;
    requiresCookieConsent: boolean;
    auth: boolean;
  } | null;
  subscriptionInfo?: {
    tier: 'premium' | 'free' | string;
    status: 'active' | 'inactive' | string;
    state: string;
    platform: string;
    expiresAt: number;
    isSubscription: boolean;
    isTrial: boolean;
  };
  subscription?: 'premium' | 'free' | string;
}

// ── Forecast ──────────────────────────────────────────────────────────────

export interface ForecastHeader {
  model: string;
  refTime: string;
  update: string;
  updateTs: number;
  elevation: number;
  step: number;
  utcOffset: number;
  tzName: string;
  /** unix ms — today's sunset */
  sunset: number;
  /** unix ms — today's sunrise */
  sunrise: number;
  hasWaves: boolean;
  daysAvail: number;
  modelElevation: number;
}

export interface Celestial {
  /** ISO Z */
  night: string;
  sunsetTs: number;
  sunriseTs: number;
  duskTs: number;
  isDay: boolean;
  atSea: number;
  TZname: string;
  TZoffset: number;
  TZoffsetMin: number;
  TZoffsetFormatted: string;
  TZabbrev: string;
  TZtype: string;
  /** ISO with offset */
  nowObserved: string;
  /** "HH:mm" local */
  sunset: string;
  sunrise: string;
  dusk: string;
}

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface DaySummary {
  icon: number;
  date: string;
  index: number;
  timestamp: number;
  weekday: Weekday;
  day: number;
  /** Kelvin */
  tempMax: number;
  /** Kelvin */
  tempMin: number;
  /** m/s */
  wind: number;
  /** meteorological degrees (FROM direction) */
  windDir: number;
  segments: number;
}

export interface TimeseriesData {
  /** unix ms timestamps for each sample */
  ts: number[];
  /** Kelvin */
  temp: number[];
  /** mm */
  snow: number[];
  /** m/s */
  wind: number[];
  /** mm precipitation */
  mm: number[];
  // Extended fields available when setup omitted:
  dewpoint?: number[];
  wind_u?: number[];
  wind_v?: number[];
  gust?: number[];
  rh?: number[];
  pressure?: number[];
  clouds_low?: number[];
  clouds_mid?: number[];
  clouds_high?: number[];
  hClouds?: number[];
  cape?: number[];
  ptype?: number[];
  [k: string]: number[] | undefined;
}

export interface NowSnapshot {
  /** Kelvin */
  temp: number;
  /** m/s */
  wind: number;
  icon: number;
  windDir: number;
  /** 0..7 */
  moonPhase: number;
}

export interface PointForecast {
  header: ForecastHeader;
  celestial: Celestial;
  /** YYYY-MM-DD → daily summary (only when setup=summary) */
  summary?: Record<string, DaySummary>;
  data: TimeseriesData;
  now: NowSnapshot;
}

// ── Search / geocoding ────────────────────────────────────────────────────

export type SearchResultType =
  | 'city'
  | 'suburb'
  | 'suburb_part'
  | 'state'
  | 'country'
  | 'webcam'
  | string;

export interface SearchResult {
  id: string;
  lat: number;
  lon: number;
  title: string;
  type: SearchResultType;
  cc?: string;
  country?: string;
  region?: string;
  state?: string;
  /** "minLat,minLon,maxLat,maxLon" */
  bounds?: string;
  webcamId?: string;
}

export interface SearchResponse {
  header: { type: string };
  data: SearchResult[];
}

export interface ReverseGeocode {
  suburb?: string;
  city?: string;
  district?: string;
  state?: string;
  country: string;
  country_code: string;
  location: { name: string; id: string };
}

// ── POIs ──────────────────────────────────────────────────────────────────

export interface AirQualityPOI {
  id: string;
  lat: number;
  lon: number;
  name: string;
  /** ISO Z */
  time: string;
  dataSource: string;
  source: string;
  stationID: string;
  rank: number;
  type: 'airq';
  quality: number;
  size: number;
  /** minutes since measurement */
  diff: number;
  aqi: number | null;
  co: number | null; co_aqi: number | null;
  no2: number | null; no2_aqi: number | null;
  o3: number | null; o3_aqi: number | null;
  pm10: number | null; pm10_aqi: number | null;
  pm25: number | null; pm25_aqi: number | null;
  so2: number | null; so2_aqi: number | null;
}

export interface NearbyAirQualityStation {
  id: string;
  name: string;
  dataSource: string;
  /** km */
  dist: number;
  lon: number;
  lat: number;
  aqi: number | null;
  diff: number;
  hAgo: number;
  minAgo: number;
}

export type StationType = 'ad' | 'wmo' | 'pws' | 'madis';

export interface NearbyWeatherStation {
  id: string;
  name: string;
  type: StationType;
  lat: number;
  lon: number;
  dist: number;
  diff: number;
  hAgo: number;
  minAgo: number;
  /** °C */
  temp: number | null;
  /** m/s */
  wind: number | null;
  /** m/s */
  gust: number | null;
  /** degrees */
  dir: number | null;
  precip: number | null;
  precip_time: number | null;
  /** hPa */
  qnh: number | null;
  /** percent */
  rh: number | null;
  /** °C */
  dew_point: number | null;
  wx_icon: number | null;
  is_airport?: 0 | 1;
}

// ── Observations timeseries ───────────────────────────────────────────────

/**
 * Nested observation-metrics block that windy attaches to the obs header.
 * Counts and frequencies are server-computed over the returned window.
 */
export interface ObservationMetrics {
  /** Total observation records in the returned series. */
  records: number;
  /** Average delay (minutes) between observation publish time and the timestamp it reports. */
  avgDelayMin: number;
  /** Average frequency (minutes) between consecutive observations. */
  avgFreqMin: number;
  /** ISO-8601 UTC timestamp of the latest observation in the series. */
  latestObs: string;
}

/**
 * Observation series header. Phase 4b sampling (3 AD airports + a PWS) shows
 * the header is much richer than the legacy fields below — `source_name`,
 * `subtype`, `avg_delay_min`, `obs_count`, `latest_obs`, `desc`, `observation`
 * (nested), `duplicityId`/`duplicityType` are all consistently present.
 */
export interface ObservationHeader {
  lat: number;
  lon: number;
  name: string;
  /** ISO Z — when windy last refreshed this series. */
  updated: string;
  id: string;
  /** `1` for airport stations, `0` otherwise. Server returns the numeric. */
  is_airport: 0 | 1;
  /** Total records in the returned series (matches `observation.records`). */
  size: number;
  /** Magnetic declination at the station, degrees. */
  declination: number;
  /** `dataSource` is the legacy field name; modern responses use `source_name` (e.g. `adds`, `noaa`). Either may be present depending on station type. */
  dataSource?: string;
  /** Upstream feed identifier (e.g. `adds`, `noaa`). Phase 4b shows this is the modern field — `dataSource` is the legacy name. */
  source_name?: string;
  /** Station-subtype classification mirroring the airport classification (e.g. `large_airport`). Same value as `desc` on AD rows. */
  subtype?: string;
  /** Average observation publish-delay, minutes (duplicates `observation.avgDelayMin`). */
  avg_delay_min?: number;
  /** Count of obs records in the series (duplicates `size`). */
  obs_count?: number;
  /** ISO-8601 UTC of the latest observation (duplicates `observation.latestObs`). */
  latest_obs?: string;
  /** Free-form description string. For AD rows it equals `subtype`. */
  desc?: string;
  /** Nested metrics block — see ObservationMetrics. Present on all sampled AD rows. */
  observation?: ObservationMetrics;
  /** Id of a related station record (e.g. the WMO synoptic that mirrors this airport's METAR). */
  duplicityId?: string;
  /** Type of the related station (`wmo`, `ad`, …). */
  duplicityType?: string;
  /** Other station IDs in this duplicate group (excludes the row's own id; intersects with duplicityId). */
  duplicates: string[];
  /** Hours per sample. */
  step: number;
  /** Unix ms — start of the returned window. */
  start: number;
  type: StationType | 'airq';
}

export interface ObservationTimeseries {
  header: ObservationHeader;
  segments: Array<{ start: number; end: number }>;
  data: { ts: number[]; [key: string]: (number | null)[] };
  calData?: {
    day: string[];
    hour: number[];
    ts: number[];
    isDay: number[];
  };
  summary?: Record<
    string,
    {
      date: string;
      index: number;
      timestamp: number;
      end: number;
      weekday: Weekday;
      day: number;
      segments: number;
    }
  >;
  celestial?: Celestial;
}

// ── Webcams ───────────────────────────────────────────────────────────────

export interface Webcam {
  id: number;
  title: string;
  lastUpdate: number;
  lastDaylight: number;
  location: {
    lat: number;
    lon: number;
    title: string;
    city: string;
    country: string;
  };
  images: {
    current: string;
    daylight: string;
  };
}

export interface WebcamList {
  cams: Webcam[];
  total: number;
}

// ── Alerts ────────────────────────────────────────────────────────────────

/**
 * Local-time decomposition that windy attaches to alert start/end timestamps.
 * All fields are strings as the server delivers them (note: `hour` is `"00"`-padded as a string, weekday is the 3-letter code).
 */
export interface CapAlertLocalTime {
  weekday: Weekday;
  /** Day-of-month, 2-digit string (`"01"`..`"31"`). */
  day: string;
  /** Localized month name (`"May"`, `"Jan"`, etc.) — language follows `WINDY_LANG`. */
  month: string;
  /** 4-digit year (`"2026"`). */
  year: string;
  /** Hour-of-day, 24h, 2-digit string (`"00"`..`"23"`). */
  hour: string;
}

/**
 * windy CAP alert as actually returned by `/capalerts/{lat}/{lon}`.
 *
 * Note this is **not** the wrapped CAP-standard envelope (`sender`/`sent`/`status`/`msgType`/`scope`/`info`).
 * windy flattens to a single object with single-letter `type`/`severity` codes plus a localized `event` label and `headline` sentence.
 *
 * Observed `type` codes (Phase 4b sample): `"F"` (Flood), `"T"` (Thunderstorms), `"W"` (Wind). More likely exist.
 * Observed `severity` codes (Phase 4b sample): `"M"` (Minor/Moderate), `"S"` (Severe). More likely exist.
 */
export interface CapAlert {
  /** Alert id from the issuing authority (numeric string). */
  id: string;
  /** Start of the alert window, unix milliseconds UTC. */
  start: number;
  /** End of the alert window, unix milliseconds UTC. */
  end: number;
  /** Single-letter category code. Observed: `F`, `T`, `W`. */
  type: string;
  /** Single-letter severity code. Observed: `M`, `S`. */
  severity: string;
  /** Short human-readable event label (e.g. "Flood Watch", "Thunderstorms", "Wind"). Localized to `WINDY_LANG`. */
  event: string;
  /** Full alert sentence as published (e.g. "Flood Watch issued May 22 at 10:34AM CDT until May 25 at 7:00PM CDT by NWS Houston/Galveston TX"). */
  headline: string;
  /** Start of the alert window in the location's local time, decomposed. */
  startLocal: CapAlertLocalTime;
  /** End of the alert window in the location's local time, decomposed. */
  endLocal: CapAlertLocalTime;
}

export interface LiveAlertsResponse {
  alerts: unknown[];
}

// ── Storms (tropical cyclones) ────────────────────────────────────────────

export interface Storm {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Saffir-Simpson category numeric (0 = tropical depression) */
  strength: number;
  /** m/s */
  windSpeed: number;
}

export interface StormsResponse {
  storms: Storm[];
  models: Record<
    string,
    { name: string; shortName: string; is_operated_by_windy: boolean }
  >;
  defaultCircles: Record<string, number>;
}

// ── Tides ─────────────────────────────────────────────────────────────────

export interface TidePoint {
  /** unix ms */
  ts: number;
  /** meters above chart datum */
  height: number;
}

export interface TideForecast {
  header: {
    name?: string;
    lat: number;
    lon: number;
    tzName?: string;
    [k: string]: unknown;
  };
  data: {
    ts: number[];
    height: number[];
  };
  extremes?: Array<{ ts: number; height: number; type: 'high' | 'low' }>;
}

// ── User data ─────────────────────────────────────────────────────────────

/**
 * Server-side wrapped favourite item.
 *
 * The server stores each favourite as `{ id, updated, value: FavouriteValue }`.
 * `value` is the user-supplied payload; `updated` is the server's last-modified ms.
 */
export interface FavouriteValue {
  type: 'fav';
  version: string;
  lat: number;
  lon: number;
  title: string;
  /** unix ms */
  updated: number;
  userId: number;
  id: string;
  deleted: null | number;
  /** "lat/lon" string */
  key: string;
  userID: string;
  counter: number;
  cc?: string;
  note?: string;
  pin?: boolean;
  pinOrder?: number;
}

export interface Favourite {
  id: string;
  /** unix ms */
  updated: number;
  value: FavouriteValue;
}

export interface UserAlert {
  key?: string;
  title?: string;
  enabled?: boolean;
  conditions?: unknown;
  storeTs?: number;
  [k: string]: unknown;
}

// ── Output / utility ──────────────────────────────────────────────────────

export type Latitude = number;
export type Longitude = number;

/** Standard Windy point forecast models. */
export const POINT_MODELS = [
  'gfs',
  'ecmwf',
  'icon',
  'iconEu',
  'iconD2',
  'mblue',
  'namConus',
  'namHawaii',
  'namAlaska',
  'arome',
  'aromeAntilles',
  'aromeFrance',
  'aromeReunion',
  'canHrdps',
  'canRdwpsWaves',
  'czeAladin',
  'hrrrAlaska',
  'hrrrConus',
  'bomAccess',
  'bomAccessAd',
  'bomAccessBn',
  'bomAccessDn',
  'bomAccessNq',
  'bomAccessPh',
  'bomAccessSy',
  'bomAccessVt',
  'ukv',
  'jmaMsm',
  'jmaCwmWaves',
  'iconEuWaves',
  'ecmwfWaves',
] as const;
export type PointModel = (typeof POINT_MODELS)[number];

export interface ModelCatalogEntry {
  /** API identifier used in path-builder calls. */
  key: PointModel | string;
  /** Display name as shown in the SPA. */
  name: string;
  /** Issuing center. */
  provider: string;
  /** Server-side model identifier (used in tile URLs etc.). */
  modelIdent: string;
  /** Horizontal resolution in km. */
  resKm: number;
  /** Forecast horizon in hours. */
  forecastHours: number;
  /** Free-tier refresh interval in minutes (how often a new model run is exposed). */
  freeIntervalMin: number;
  /** Premium-tier refresh interval in minutes. `null` = no premium uplift. */
  premiumIntervalMin: number | null;
  /** Coverage: 'global' or a region. */
  scope: 'global' | 'regional';
  /** "wind" / "temperature" / "wave" / "air_quality" — primary domain. */
  domain: 'general' | 'waves' | 'air_quality';
}

/**
 * Hand-curated catalog of Windy's point-forecast models, captured 2026-05-13
 * from `window.W.products` in the SPA. Premium subscribers get faster refresh
 * intervals (see `premiumIntervalMin`) AND hourly temporal step for the first
 * 90-120 hours (vs 3-hourly for free users).
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // Global
  { key: 'ecmwf', name: 'ECMWF',         provider: 'ECMWF',  modelIdent: 'ecmwf-hres',  resKm: 9,   forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'global',   domain: 'general' },
  { key: 'gfs',   name: 'GFS',           provider: 'NOAA',   modelIdent: 'gfs',         resKm: 22,  forecastHours: 360, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'global',   domain: 'general' },
  { key: 'icon',  name: 'ICON',          provider: 'DWD',    modelIdent: 'icon-global', resKm: 13,  forecastHours: 168, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'global',   domain: 'general' },
  { key: 'mblue', name: 'METEOBLUE',     provider: 'Meteoblue', modelIdent: '',         resKm: 0,   forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: null, scope: 'global',  domain: 'general' },
  // High-res regional — premium uplifts to 3-4× faster refresh
  { key: 'hrrrConus',   name: 'HRRR (CONUS)',     provider: 'NCEP',       modelIdent: 'hrrr-conus',     resKm: 3,   forecastHours: 72,  freeIntervalMin: 720, premiumIntervalMin: 60,  scope: 'regional', domain: 'general' },
  { key: 'hrrrAlaska',  name: 'HRRR-AK',          provider: 'NCEP',       modelIdent: 'hrrr-alaska',    resKm: 3,   forecastHours: 72,  freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'iconD2',      name: 'ICON-D2',          provider: 'DWD',        modelIdent: 'icon-d2',        resKm: 2.2, forecastHours: 48,  freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'iconEu',      name: 'ICON-EU',          provider: 'DWD',        modelIdent: 'icon-eu',        resKm: 7,   forecastHours: 120, freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'arome',       name: 'AROME-HD',         provider: 'Météo-France', modelIdent: 'arome',         resKm: 1.3, forecastHours: 42,  freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'aromeFrance', name: 'AROME (France)',   provider: 'Météo-France', modelIdent: 'arome-france',  resKm: 2.5, forecastHours: 42,  freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'aromeAntilles', name: 'AROME (Antilles)', provider: 'Météo-France', modelIdent: 'arome-antilles', resKm: 2.5, forecastHours: 42, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'aromeReunion', name: 'AROME (Réunion)', provider: 'Météo-France', modelIdent: 'arome-reunion', resKm: 2.5, forecastHours: 42,  freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'ukv',         name: 'UKV',              provider: 'Met Office', modelIdent: 'ukv',            resKm: 2,   forecastHours: 120, freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'namConus',    name: 'NAM (CONUS)',      provider: 'NOAA',       modelIdent: 'nam-conus',      resKm: 5,   forecastHours: 72,  freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'namHawaii',   name: 'NAM-HI',           provider: 'NOAA',       modelIdent: 'nam-hawaii',     resKm: 3,   forecastHours: 72,  freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'namAlaska',   name: 'NAM-AK',           provider: 'NOAA',       modelIdent: 'nam-alaska',     resKm: 6,   forecastHours: 72,  freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'canHrdps',    name: 'HRDPS',            provider: 'MSC Canada', modelIdent: 'can-hrdps',      resKm: 2.5, forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'czeAladin',   name: 'ALADIN',           provider: 'CHMI Czech', modelIdent: 'cze-aladin',     resKm: 2.3, forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'jmaMsm',      name: 'MSM',              provider: 'JMA Japan',  modelIdent: 'jma-msm',        resKm: 5,   forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 180, scope: 'regional', domain: 'general' },
  { key: 'bomAccess',   name: 'ACCESS (Australia)', provider: 'BOM',      modelIdent: 'bom-access',     resKm: 12,  forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessAd', name: 'ACCESS-C Adelaide',  provider: 'BOM',      modelIdent: 'bom-access-c-ad', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessBn', name: 'ACCESS-C Brisbane',  provider: 'BOM',      modelIdent: 'bom-access-c-bn', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessDn', name: 'ACCESS-C Darwin',    provider: 'BOM',      modelIdent: 'bom-access-c-dn', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessNq', name: 'ACCESS-C N. Queensland', provider: 'BOM',  modelIdent: 'bom-access-c-nq', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessPh', name: 'ACCESS-C Perth',     provider: 'BOM',      modelIdent: 'bom-access-c-ph', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessSy', name: 'ACCESS-C Sydney',    provider: 'BOM',      modelIdent: 'bom-access-c-sy', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  { key: 'bomAccessVt', name: 'ACCESS-C Victoria/Tas.', provider: 'BOM',  modelIdent: 'bom-access-c-vt', resKm: 1.5, forecastHours: 36, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'general' },
  // Waves
  { key: 'ecmwfWaves',  name: 'ECMWF WAM',  provider: 'ECMWF', modelIdent: 'ecmwf-wam',  resKm: 9,   forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'global',   domain: 'waves' },
  { key: 'gfsWaves',    name: 'GFS Wave',   provider: 'NOAA',  modelIdent: 'gfs-wave',   resKm: 22,  forecastHours: 360, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'global',   domain: 'waves' },
  { key: 'iconEuWaves', name: 'ICON-EU EWAM', provider: 'DWD', modelIdent: 'icon-ewam', resKm: 7,    forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: null, scope: 'regional', domain: 'waves' },
  { key: 'jmaCwmWaves', name: 'CWM',        provider: 'JMA Japan', modelIdent: 'jma-cwm', resKm: 5,  forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'waves' },
  { key: 'canRdwpsWaves', name: 'RDWPS',    provider: 'MSC Canada', modelIdent: 'can-rdwps', resKm: 2.5, forecastHours: 240, freeIntervalMin: 720, premiumIntervalMin: 360, scope: 'regional', domain: 'waves' },
  // Air quality
  { key: 'cams',   name: 'CAMS (Global)',  provider: 'Copernicus', modelIdent: 'cams-global', resKm: 40, forecastHours: 240, freeIntervalMin: 720,  premiumIntervalMin: null, scope: 'global',   domain: 'air_quality' },
  { key: 'camsEu', name: 'CAMS (Europe)',  provider: 'Copernicus', modelIdent: 'cams-eu',     resKm: 10, forecastHours: 240, freeIntervalMin: 1440, premiumIntervalMin: null, scope: 'regional', domain: 'air_quality' },
];

/**
 * Premium-only forecast features that go beyond just refresh-rate uplift:
 *
 * 1. **Hourly temporal step** (`step=1`) for hours 1-90 on ECMWF and 1-120 on
 *    GFS. Free users get `step=3` (3-hourly) for those windows.
 * 2. **Extended 15-day window** on ECMWF when `extended=true` is passed.
 *    Free users are capped at 10 days.
 * 3. **Most-recent model run** — premium gets the new run (e.g., 06Z) as soon
 *    as it's available; free users may be delayed to the previous run.
 *
 * Source: comparing `/metadata/v1.0/forecast/{model}/minifest.json` with and
 * without `?premium=true` for the same model.
 */
export const PREMIUM_FEATURES = {
  hourlyStepHours: { ecmwf: 90, gfs: 120 },
  extendedDaysEcmwf: { free: 10, premium: 15 },
  modelRunFreshness: 'premium receives the new model run earlier than free',
} as const;

export const AIR_QUALITY_MODELS = ['cams', 'camsEu'] as const;
export type AirQualityModel = (typeof AIR_QUALITY_MODELS)[number];

export const POI_TYPES = ['airq', 'stations', 'tides', 'webcams'] as const;
export type PoiType = (typeof POI_TYPES)[number];

/** Renderable weather overlays (66) — used as the layer query in IMS tile URLs. */
export const OVERLAYS = [
  // Wind / temperature / humidity
  'wind', 'temp', 'wetbulbtemp', 'dewpoint', 'gust', 'gustAccu', 'rh',
  // Precipitation / clouds
  'rain', 'rainAccu', 'snowAccu', 'snowcover', 'ptype',
  'clouds', 'lclouds', 'mclouds', 'hclouds', 'cloudtop', 'ccl', 'cbase',
  // Stability / convection
  'cape', 'thunder', 'deg0', 'turbulence', 'icing',
  // Pressure
  'pressure',
  // Solar / UV
  'solarpower', 'uvindex',
  // Waves / ocean
  'waves', 'wwaves', 'wavePower', 'swell', 'swell1', 'swell2', 'swell3',
  'currents', 'currentsTide', 'sst', 'visibility', 'fog',
  // Air quality (CAMS)
  'gtco3', 'pm2p5', 'no2', 'aod550', 'tcso2', 'go3', 'cosc', 'dustsm', 'aqi',
  // Imagery / composite layers
  'radar', 'satellite', 'topoMap', 'heatmaps',
  // Overlays sourced from external products
  'capAlerts', 'avalancheDanger', 'hurricanes',
  // ECMWF Extreme Forecast Index
  'efiWind', 'efiTemp', 'efiRain',
  // Drought / soil / fire (CzechGlobe)
  'moistureAnom40', 'moistureAnom100',
  'drought40', 'drought100',
  'soilMoisture40', 'soilMoisture100',
  'fwi', 'dfm10h',
] as const;
export type Overlay = (typeof OVERLAYS)[number];

/** Atmospheric levels supported by the meteogram pressure-level keys. */
export const LEVELS = [
  'surface', '100m',
  '975h', '950h', '925h', '900h', '850h', '800h',
  '700h', '600h', '500h', '400h', '300h', '250h',
  '200h', '150h', '10h',
] as const;
export type Level = (typeof LEVELS)[number];

/** Approximate altitude / flight level for each pressure surface. */
export const LEVEL_ALTITUDE: Record<Level, { hPa?: string; altM: number; altFt: number; flightLevel?: string }> = {
  surface: { altM: 0, altFt: 0 },
  '100m':  { altM: 100, altFt: 330 },
  '975h':  { hPa: '975 hPa', altM: 300, altFt: 1000 },
  '950h':  { hPa: '950 hPa', altM: 600, altFt: 2000 },
  '925h':  { hPa: '925 hPa', altM: 750, altFt: 2500 },
  '900h':  { hPa: '900 hPa', altM: 900, altFt: 3000 },
  '850h':  { hPa: '850 hPa', altM: 1500, altFt: 5000 },
  '800h':  { hPa: '800 hPa', altM: 2000, altFt: 6400 },
  '700h':  { hPa: '700 hPa', altM: 3000, altFt: 10000, flightLevel: 'FL100' },
  '600h':  { hPa: '600 hPa', altM: 4200, altFt: 14000, flightLevel: 'FL140' },
  '500h':  { hPa: '500 hPa', altM: 5500, altFt: 18000, flightLevel: 'FL180' },
  '400h':  { hPa: '400 hPa', altM: 7000, altFt: 24000, flightLevel: 'FL240' },
  '300h':  { hPa: '300 hPa', altM: 9000, altFt: 30000, flightLevel: 'FL300' },
  '250h':  { hPa: '250 hPa', altM: 10000, altFt: 34000, flightLevel: 'FL340' },
  '200h':  { hPa: '200 hPa', altM: 11700, altFt: 39000, flightLevel: 'FL390' },
  '150h':  { hPa: '150 hPa', altM: 13500, altFt: 45000, flightLevel: 'FL450' },
  '10h':   { hPa: '10 hPa', altM: 30000, altFt: 98000, flightLevel: 'FL980' },
};

/** Basemap styles served by `tiles.windy.com/tiles/v11.2/{style}`. */
export const BASEMAP_STYLES = [
  'darkmap', 'darkmap-retina',
  'lightmap', 'lightmap-retina',
  'sat', 'sat-retina',
  'winter', 'winter-retina',
  'topomap', 'topomap-retina',
] as const;
export type BasemapStyle = (typeof BASEMAP_STYLES)[number];

/** UI/label languages supported by Windy (captured from W.rootScope.supportedLanguages). */
export const SUPPORTED_LANGUAGES = [
  'en', 'zh-TW', 'zh', 'ja', 'fr', 'ko', 'it', 'ru', 'nl', 'cs', 'tr', 'pl',
  'sv', 'fi', 'ro', 'el', 'hu', 'hr', 'ca', 'da', 'ar', 'fa', 'hi', 'ta',
  'sk', 'uk', 'bg', 'he', 'is', 'lt', 'et', 'vi', 'sl', 'sr', 'id', 'th',
  'sq', 'pt', 'nb', 'es', 'de', 'bn',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ── Sounding (pressure-level meteogram) ──────────────────────────────────

export interface PressureLevelSample {
  level: Level;
  altM: number;
  altFt: number;
  /** Kelvin */
  temp?: number;
  /** Kelvin */
  dewpoint?: number;
  /** percent */
  rh?: number;
  /** geopotential height in meters */
  gh?: number;
  /** m/s zonal */
  wind_u?: number;
  /** m/s meridional */
  wind_v?: number;
  /** m/s magnitude */
  wind?: number;
  /** meteorological degrees */
  windDir?: number;
}

export interface SoundingTimestep {
  /** unix ms */
  ts: number;
  /** Hours from model reference time. */
  hoursOffset: number;
  levels: PressureLevelSample[];
}

export interface Sounding {
  header: {
    model: string;
    refTime: string;
    lat: number;
    lon: number;
    tzName?: string;
    step: number;
  };
  timesteps: SoundingTimestep[];
}

// ── Airport ──────────────────────────────────────────────────────────────

export interface AirportRunway {
  id: number;
  closed: 0 | 1;
  lighted: 0 | 1;
  surface: string; // "ASP", "CON", "GRS"...
  he_ident: string;
  le_ident: string;
  width_ft: number;
  length_ft: number;
  airport_ref: number;
  airport_ident: string;
  he_elevation_ft: number;
  he_heading_degT: number;
  he_latitude_deg: number;
  le_elevation_ft: number;
  le_heading_degT: number;
  le_latitude_deg: number;
  he_longitude_deg: number;
  le_longitude_deg: number;
  he_displaced_threshold_ft: number | null;
  le_displaced_threshold_ft: number | null;
}

export interface AirportInfo {
  id: string;
  iata?: string;
  subtype: 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport' | 'seaplane_base' | string;
  name: string;
  source: string;
  home_link?: string;
  wikipedia_link?: string;
  keywords: string | null;
  elev_ft: string;
  elev_m: string;
  scheduled_service: 'yes' | 'no';
  runways: AirportRunway[];
  /** Latest METAR — keys vary by source. */
  metar?: unknown;
  /** Latest TAF if available. */
  taf?: unknown;
  /** Frequencies / radio info if available. */
  frequencies?: unknown[];
}

export interface AirportResponse {
  info: AirportInfo;
}

// ── User Alerts ──────────────────────────────────────────────────────────

export type AlertConditionType =
  | 'cloudiness'
  | 'freshSnow'
  | 'rainfall'
  | 'swell'
  | 'temperature'
  | 'time'
  | 'wind';

export type AlertStatus = 'triggered' | 'normal' | 'suspended';

export interface UserAlertCondition {
  type: AlertConditionType;
  /** Threshold values; shape depends on `type` */
  [k: string]: unknown;
}

export interface UserAlertItem {
  id?: string;
  /** Server wraps `value` similarly to favourites */
  value?: {
    type: 'alert';
    version: string;
    lat: number;
    lon: number;
    title: string;
    enabled: boolean;
    conditions: UserAlertCondition[];
    status?: AlertStatus;
    updated: number;
    userID: string;
    counter: number;
    [k: string]: unknown;
  };
  updated?: number;
  storeTs?: number;
}
