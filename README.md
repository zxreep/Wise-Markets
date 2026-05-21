# Wise Markets API

Lightweight Node.js + TypeScript financial market aggregation API built with Fastify. It uses an exchange registry, provider capability routing, and adapter-based integrations while avoiding databases, cron jobs, browser automation, persistent storage, and heavyweight scraping.

## Run locally

```bash
npm install
npm run dev
```

OpenAPI docs are available at `/docs`.

## Core endpoints

- `GET /trending/:exchange`
- `GET /about/current/:exchange/:symbol`
- `GET /securities/:exchange`
- `GET /events/:exchange/:symbol`
- `GET /chart/:exchange/:symbol`
- `GET /financials/:exchange/:symbol`
- `GET /holders/:exchange/:symbol`
- `GET /search?q=`
- `GET /exchanges`
- `GET /providers/capabilities`
- `GET /market/indices`
- `GET /market/movers`
- `GET /compare/:symbols`
- `GET /crypto/trending`
- `GET /forex/rates`

Examples:

- `GET /about/current/NSE/RELIANCE`
- `GET /about/current/NASDAQ/AAPL`
- `GET /about/current/BINANCE/BTCUSDT`
- `GET /chart/FOREX/EURUSD`

Optional provider keys:

- `FINANCEAPI_KEY`
- `FRED_API_KEY`
- `NEWSAPI_KEY`
