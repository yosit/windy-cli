---
title: Windy API Intent
tags: [windy, api, intent, screens]
---

# Windy API Intent

Maps each endpoint to the UI screen that triggers it and the user-visible feature it powers.

## Conventions

- **Screen**: UI surface where the request is initiated.
- **Intent**: User-visible feature served.
- **Trigger**: What action causes the request.

## Bootstrap

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET account.windy.com/api/info` | All | Identify user + load fresh JWT | Page load; periodically on visibility change |
| `GET node.windy.com/services/umisteni` | All | Ad/feature placement decision | Page load |
| `GET node.windy.com/metadata/v1.0/forecast/{model}/minifest.json` | All | Determine available reftimes / models for current tier | Page load + model switch |
| `GET www.windy.com/patch/v{N}/patch.js` | All | Hot-patch loader | Page load (latest patch refreshed periodically) |

## Home page weather layers

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET ims.windy.com/im/v3.0/forecast/{model}/{run}/{forecast}/wm_grid_257/{z}/{x}/{y}/{layer}.jpg` | Home map | Per-overlay weather data tile (wind, temp, rain, pressure, clouds, waves) | Layer activation + map pan/zoom + time scrub |
| `GET tiles.windy.com/labels/v2.0/{lang}/{z}/{x}/{y}.json` | Home map | Place-name labels | Map pan/zoom |
| `GET tiles.windy.com/tiles/v11.2/{style}/{z}/{x}/{y}.png` | Home map | Basemap (dark/light/sat/winter) | Map pan/zoom + style change |
| `GET node.windy.com/citytile/v1.0/{model}/{z}/{x}/{y}` | Home map | City overlay: per-city pill showing name + temperature for the focused timestep | Map pan/zoom + time scrub |
| `GET node.windy.com/capalerts/{lat}/{lon}` | Home map | "Severe weather" badge on home page when alert active for user location | Page load (centered on user) |

## Detail panel ("rh-pane")

Opened by clicking the map or a search result.

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /forecast/{kind}/{model}/v2.9/{lat}/{lon}?setup=summary&includeNow=true` | Detail panel | The forecast table (14-day) + "now" snapshot | Detail panel opens |
| `GET /reverse/v3/{lat}/{lon}/{zoom}` | Detail panel header | Resolve "About this location" name | Detail panel opens |
| `GET /services/elevation/{lat}/{lon}` | Detail panel header | "Elevation: Xm" line | Detail panel opens |
| `GET /services/v1/timezone/{lat}/{lon}` | Detail panel header | Local time / sunset / sunrise | Detail panel opens |
| `GET /capalerts/{lat}/{lon}?source=detail` | Detail panel | CAP alert badge at top of detail | Detail panel opens |
| `GET /notif/v1/live-alerts/{lat}/{lon}` | Detail panel | Live alerts surfacing | Detail panel opens |
| `GET /webcams/v2.0/list?nearby={lat,lon}&imageSize=thumbnail` | Detail panel → "Webcams in vicinity" | List of nearby webcams as thumbnails | User scrolls / clicks "Webcams in vicinity" |
| `GET /pois/v2/stations/{lat}/{lon}` | Detail panel → "Nearest weather stations" | Stations distance-sorted | User clicks "Nearest weather stations" |
| `GET /pois/v2/airq/{lat}/{lon}` | Detail panel → "Air quality and radiation monitoring" | AQ stations near point | User clicks AQ tab/section |
| `POST /users/settings` | Detail panel | Persist last viewed location so it's restored on next visit | Map click / panel open |

## Search box

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /search/v4.1/{biasLat}/{biasLon}/{query}?lang&size` | Top search bar | Autocomplete dropdown + result selection | Each keystroke (debounced) |
| `GET node-s.windy.com/imaker/map?c={lat,lon}&z=10&size=280` | Search result row | Thumbnail map preview next to each city result | Result render |

## Hurricanes overlay

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /tc/v2/storms` | Hurricane layer | Show active storms as moving icons | Layer activation; refresh every N seconds |
| `GET /tc/v2/storms/active/count` | Top-right banner | Show "N active storms" badge | Page load |
| `GET /tc/v2/storms/{id}` _(not yet captured)_ | Hurricane detail | Show forecast track + cone | Storm icon click |

## Air-quality station detail

Reached via search result of type `airq` or by clicking the AQ tab.

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /pois/v2/airq/{id}` | AQ station page | Show latest measurement (PM2.5, AQI, etc.) | Page load |
| `GET /obs/measurement/v3/airq/{id}/10/1` | AQ station page | Historical 10-day hourly chart | Page load |
| `GET /pois/v2/airq/{lat}/{lon}` | AQ station page right panel | "Other stations nearby" list | Page load |
| `GET /maptile/2.1/maptile/newest/satellite.day/{z}/{x}/{y}/256/jpg` | AQ station page | Satellite basemap zoomed to station | Map render |

## Weather-station / airport detail

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /pois/v2/{type}/{id}` | Station page | Station metadata + latest report | Page load |
| `GET /obs/measurement/v3/{type}/{id}/{days}/{step}` | Station page | Historical observations chart | Page load + tab switch (1d/7d/30d) |
| `GET /pois/v2/stations/{lat}/{lon}` | Station page right panel | Nearby stations list | Page load |

## Webcams

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /webcams/v2.0/list?nearby={lat,lon}` | Webcams plugin | List of webcams near point | Plugin open |
| `GET /webcams/v2.0/detail/{id}` | Webcam detail | Full webcam page | Webcam click |
| `GET /webcams/v3.0/archive/{id}` | Webcam detail → "Archive" tab | Past 24h / 1 week footage browse | Tab switch |
| `GET /webcams/v2.0/archive/hourly/{id}` | Webcam detail | Hourly archive filmstrip | Page load |
| `GET admin.windy.com/webcams/admin/v1.0/views?textQuery` | Webcams search | Text search across all webcams | User types in webcam search |

## Tropical / marine

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /tides/v1.0/tides/{lat}/{lon}` | Detail panel → Tides tab | Tide chart for nearest port | Tab switch |
| `GET /pois/v2/tides/{lat}/{lon}` | Tides layer | Tide-station markers on map | Layer activation |

## Radar / satellite layers

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET rdr.windy.com/radar2/composite/minifest2.json` | Radar layer | Determine available frames + reftime | Layer activation |
| `GET rdr.windy.com/radar2/composite/coverage.json` | Radar layer | Show coverage polygon (dimmed where no data) | Layer activation |
| `GET sat.windy.com/satellite/composite.json` | Satellite layer | Frame index | Layer activation |

## Articles / promos

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /articles/startup/article` | Home page modal | News article banner shown once per startup | Page load |
| `GET /articles/startup/promotion` | Home page modal | Marketing promo banner | Page load |

## User data (require login)

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `GET /users/v1/data/favs` | Favs plugin / sidebar | Show saved locations | Page load (synced); favs plugin open |
| `PUT /users/v1/data/favs/{id}` | Favs plugin | Add / update a favourite | User clicks the heart icon |
| `DELETE /users/v1/data/favs/{id}` | Favs plugin | Remove a favourite | Trash icon on a fav row |
| `GET /users/v1/data/alerts` | Alerts plugin | Show user's monitoring alerts | Plugin open |
| `POST /users/v1/data/alerts` / `PUT /users/v1/data/alerts/{id}` | Alerts plugin | Create / edit an alert | "Create alert" button |
| `GET /users/v1/data/colors` | Settings → Colors | Custom palette list | Settings panel open |
| `GET /users/v1/data/plugins` | Settings → Plugins | Installed plugins | Settings panel open |
| `GET /users/settings` | Settings | UI preferences, units, home location | Settings panel open |
| `POST /users/settings` | Settings | Persist a changed preference | User toggles a setting |
| `GET /users/v3/devices/{uid}` | (background) | Push notification device registration | Page load |

## Analytics (skip)

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| `HEAD /sedlina/ga/1?dp={page}&...` | All | Google-Analytics-shaped event ping | Plugin open / click event |

## Enum reference

### Forecast model identifiers (`POINT_MODELS`)

`ecmwf`, `gfs`, `icon`, `iconEu`, `iconD2`, `mblue` (Meteoblue), `namConus`, `namHawaii`, `namAlaska`, `arome`, `aromeAntilles`, `aromeFrance`, `aromeReunion`, `canHrdps`, `canRdwpsWaves`, `czeAladin`, `hrrrAlaska`, `hrrrConus`, `bomAccess`, `bomAccessAd`, `bomAccessBn`, `bomAccessDn`, `bomAccessNq`, `bomAccessPh`, `bomAccessSy`, `bomAccessVt`, `ukv`, `jmaMsm`, `jmaCwmWaves`, `iconEuWaves`, `ecmwfWaves`

Premium-gated (typical): `hrrr*`, `ukv`, `bomAccess*`, `iconD2`, `arome*`, extended ECMWF window.

### POI types

`airq`, `stations`, `tides`, `webcams`.

### Station sub-types

| Code | Meaning |
|------|---------|
| `ad` | Airport / METAR |
| `wmo` | WMO synoptic station |
| `pws` | Personal Weather Station |
| `madis` | NOAA MADIS network |

### Search result types

`city`, `suburb`, `suburb_part`, `state`, `country`, `webcam`.

### Subscription tiers

`free`, `premium`. Server uses `subscriptionInfo.tier`; SPA reduces it to a boolean `pr` query param.

### Image sizes (webcams)

`thumbnail`, `preview`, `original`.
