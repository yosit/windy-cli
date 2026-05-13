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

export interface ObservationHeader {
  lat: number;
  lon: number;
  name: string;
  /** ISO Z */
  updated: string;
  id: string;
  is_airport: 0 | 1;
  size: number;
  declination: number;
  dataSource: string;
  duplicates: string[];
  /** hours per sample */
  step: number;
  /** unix ms */
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

export interface CapAlertInfo {
  category: string;
  event: string;
  urgency: string;
  severity: string;
  certainty: string;
  effective: string;
  expires: string;
  headline: string;
  description: string;
  instruction: string;
  area?: unknown;
}

export interface CapAlert {
  id: string;
  sender: string;
  sent: string;
  status: string;
  msgType: string;
  scope: string;
  info: CapAlertInfo;
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
  'ukv',
  'jmaMsm',
  'jmaCwmWaves',
  'iconEuWaves',
  'ecmwfWaves',
] as const;
export type PointModel = (typeof POINT_MODELS)[number];

export const AIR_QUALITY_MODELS = ['cams', 'camsEu'] as const;
export type AirQualityModel = (typeof AIR_QUALITY_MODELS)[number];

export const POI_TYPES = ['airq', 'stations', 'tides', 'webcams'] as const;
export type PoiType = (typeof POI_TYPES)[number];

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
