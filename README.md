# ⚡ SwiftLink

A full-stack URL shortener with click analytics and QR codes. Node.js + Express backend, SQLite storage, and a polished dark-themed dashboard — no build step required.

## Features

- **Shorten URLs** with auto-generated 6-character codes or custom aliases
- **302 redirects** that record every click (timestamp, referrer, user-agent)
- **Click analytics** per link: total clicks, daily clicks (last 14 days), top referrers
- **QR codes** — PNG QR code for every short link
- **Dashboard** — create links, one-click copy, link table with click counts, per-link stats with a canvas bar chart, QR display, delete
- **Dark modern theme**, vanilla HTML/CSS/JS frontend served by the same server

## Screenshots

> _Add screenshots here after running locally:_
> - `docs/dashboard.png` — main dashboard
> - `docs/stats.png` — per-link analytics view

## Run locally

```bash
cd swiftlink
npm install
npm start        # serves on http://localhost:3000
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port to listen on |
| `DB_PATH` | `./data.db` | SQLite database file |
| `BASE_URL` | auto from request | Public base URL used in QR codes |

Run the test suite:

```bash
npm test
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/links` | Create a short link. Body: `{ "url": "https://…", "alias": "optional" }`. Returns `201` with `{ code, url, shortUrl }`. Duplicate alias → `409`. Invalid URL → `400`. |
| `GET` | `/api/links` | List all links with click counts. |
| `GET` | `/:code` | Redirect (302) to the original URL and record a click. Unknown code → `404`. |
| `GET` | `/api/links/:code/stats` | Analytics: `{ totalClicks, clicksPerDay[14], topReferrers }`. |
| `GET` | `/api/links/:code/qr` | PNG QR code of the short URL. |
| `DELETE` | `/api/links/:code` | Delete a link and its clicks. Returns `204`. |

### Example

```bash
# Create
curl -X POST localhost:3000/api/links \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","alias":"demo"}'
# → {"code":"demo","url":"https://example.com","shortUrl":"http://localhost:3000/demo",...}

# Redirect (records a click)
curl -i localhost:3000/demo

# Stats
curl localhost:3000/api/links/demo/stats

# QR code
curl localhost:3000/api/links/demo/qr --output demo.png
```

## Project structure

```
swiftlink/
├── server.js            # Express app, SQLite schema, all routes
├── package.json
├── public/
│   ├── index.html       # Dashboard
│   ├── app.js           # Frontend logic + canvas chart
│   └── styles.css       # Dark theme
└── test/
    └── links.test.js    # node:test suite
```

## License

MIT
