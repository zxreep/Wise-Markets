# Wise Markets API

Lightweight Node.js + TypeScript financial market aggregation API built with Fastify. It uses adapter-based provider integrations and avoids databases, cron jobs, browser automation, persistent storage, and heavyweight scraping.

## Run locally

```bash
npm install
npm run dev
```

OpenAPI docs are available at `/docs`.

## Core endpoints

- `GET /trending/:exchange`
- `GET /about/current/:symbol`
- `GET /securities/:exchange`
- `GET /events/:symbol`
- `GET /chart/:symbol`
- `GET /search?q=`
- `GET /market/indices`
- `GET /market/movers`
- `GET /compare/:symbols`
- `GET /crypto/trending`
- `GET /forex/rates`

Optional provider keys:

- `FINANCEAPI_KEY`
- `FRED_API_KEY`
- `NEWSAPI_KEY`
