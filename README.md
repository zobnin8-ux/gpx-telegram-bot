# GPX Telegram Bot

A Telegram bot that accepts one or more GPX files and returns a public link to a clean, interactive Leaflet + OpenStreetMap web map. Each uploaded file is rendered as a separate colored segment, with distance in nautical miles (NM) and average speed in knots (kt).

## Features

- Upload one or many `.gpx` files via Telegram
- Each file becomes a separate colored segment on the map
- Distance per segment in **NM** (haversine, meters / 1852)
- Average speed per segment in **kt** (`distance_nm / duration_hours`); shows `N/A` when no time data
- Clean top-right legend and click-to-popup details
- Self-contained generated HTML using Leaflet + OpenStreetMap CDN — no API keys required
- Express static server for the generated maps
- Docker / docker-compose support

## Tech

Node.js + TypeScript, [Telegraf](https://telegraf.js.org/), Express, [Leaflet](https://leafletjs.com/), OpenStreetMap tiles.

## Project layout

```
src/
  index.ts         # bootstrap: env, server, bot
  bot.ts           # Telegram bot (Telegraf)
  server.ts        # Express static + /health
  gpx.ts           # GPX parsing, haversine, NM/kt math
  mapGenerator.ts  # HTML map renderer
  types.ts
public/maps/       # generated maps (served at /maps/<id>/index.html)
data/uploads/      # temporary GPX uploads (auto-cleaned per session)
.env.example
package.json
tsconfig.json
Dockerfile
docker-compose.yml
```

## Environment variables

Copy `.env.example` to `.env` and fill it in:

```
BOT_TOKEN=123456:your-telegram-bot-token-here
BASE_URL=https://your-domain.example.com
PORT=3000
```

- `BOT_TOKEN` — token from [@BotFather](https://t.me/BotFather)
- `BASE_URL` — public URL where this server is reachable (used to build map links)
- `PORT` — HTTP port (default 3000)

## Local run

```
npm install
cp .env.example .env   # then edit values
npm run dev
```

Build & run compiled:

```
npm run build
npm start
```

The bot polls Telegram and the HTTP server listens on `PORT`. Health check: `GET /health` returns `OK`.

## Bot usage

1. `/start` — clears any previous session and shows instructions
2. Upload one or more `.gpx` files as **documents**
3. `/done` — bot generates the map and replies with a URL like:
   ```
   https://YOUR_DOMAIN/maps/<mapId>/index.html
   ```
4. `/cancel` — clears the current session

Non-`.gpx` documents are politely rejected. Max upload size is 20 MB per file.

## Generated map

- Fullscreen Leaflet map on OpenStreetMap tiles
- Each GPX file = one colored polyline (cycled colors)
- Top-right legend lists segment name, distance (NM) and average speed (kt)
- Click a polyline to open a popup with the same data
- Bounds auto-fit to all segments
- Mobile responsive

The HTML is fully self-contained except for Leaflet + OSM tiles loaded from CDN.

## Docker

Build & run with docker-compose:

```
docker compose up -d --build
```

This persists `./public/maps` and `./data/uploads` across restarts.

Or with plain Docker:

```
docker build -t gpx-telegram-bot .
docker run -d --env-file .env -p 3000:3000 \
  -v $(pwd)/public/maps:/app/public/maps \
  -v $(pwd)/data/uploads:/app/data/uploads \
  --name gpx-telegram-bot gpx-telegram-bot
```

## Deployment notes

- **Railway / Render** — set `BOT_TOKEN`, `BASE_URL`, `PORT` env vars; deploy the repo. Use `npm run build` as build command and `npm start` as start command. Make sure `BASE_URL` matches the public URL the platform assigns.
- **VPS** — clone the repo, set `.env`, run `docker compose up -d --build`. Put a reverse proxy (Caddy / nginx) in front to terminate TLS and forward to the chosen port.
- The bot uses long polling, so no inbound webhook setup is required — just a publicly reachable `BASE_URL` for the generated map links.

## Security & cleanup

- Map IDs are `crypto.randomUUID()`
- Uploaded file names are sanitized
- Per-file size limit (20 MB)
- Temporary upload sessions are deleted after the map is generated (or on `/cancel` / `/start`)
- Generated maps live in `public/maps/<mapId>/index.html`
