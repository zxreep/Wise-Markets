import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { SMA, RSI } from "technicalindicators";
import { config } from "./config.js";
import { ProviderRegistry } from "./providers/index.js";
import type { ApiEnvelope } from "./types.js";

function envelope<T>(data: T, meta: Omit<ApiEnvelope<T>["meta"], "asOf"> & { asOf?: string }): ApiEnvelope<T> {
  return { data, meta: { ...meta, asOf: meta.asOf ?? new Date().toISOString() } };
}

const exchangeParam = { type: "object", properties: { exchange: { type: "string" } }, required: ["exchange"] };
const instrumentParams = { type: "object", properties: { exchange: { type: "string" }, symbol: { type: "string" } }, required: ["exchange", "symbol"] };

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.NODE_ENV === "test" ? "silent" : "info" } });
  const providers = new ProviderRegistry();

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW });
  await app.register(swagger, { openapi: { info: { title: "Wise Markets API", description: "Global exchange-aware market aggregation API with provider capability routing.", version: "0.2.0" }, servers: [{ url: "/" }] } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  if (config.ENABLE_WEBSOCKET) await app.register(websocket);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const fastifyError = error as { statusCode?: number; message?: string };
    const statusCode = fastifyError.statusCode && fastifyError.statusCode >= 400 ? fastifyError.statusCode : 502;
    reply.status(statusCode).send({ error: { message: fastifyError.message ?? "Provider request failed", statusCode }, meta: { asOf: new Date().toISOString() } });
  });

  app.get("/health", { schema: { summary: "Health check", tags: ["system"] } }, async () => envelope({ ok: true }, { provider: "aggregate" }));

  app.get("/exchanges", { schema: { summary: "Supported global exchange registry", tags: ["registry"] } }, async () => envelope(providers.exchanges(), { provider: "aggregate" }));
  app.get("/providers/capabilities", { schema: { summary: "Provider capability map", tags: ["registry"] } }, async () => envelope(providers.capabilities(), { provider: "aggregate" }));

  app.get<{ Params: { exchange: string } }>("/trending/:exchange", { schema: { summary: "Top gainers, losers, most traded, and trending assets by exchange", tags: ["markets"], params: exchangeParam } }, async (request) => {
    const data = await providers.trending(request.params.exchange);
    return envelope(data, { provider: "aggregate", exchange: request.params.exchange, fallbackProviders: ["yahoo", "financeapi", "coingecko", "stooq"] });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/about/current/:exchange/:symbol", { schema: { summary: "Exchange-aware security/company snapshot", tags: ["securities"], params: instrumentParams, querystring: { type: "object", properties: { assetType: { type: "string" } } } } }, async (request) => {
    const data = await providers.securityOverview(request.params.exchange, request.params.symbol, request.query.assetType);
    return envelope(data, { provider: "aggregate", symbol: data.symbol, exchange: data.exchange, assetType: data.assetType, fallbackProviders: providers.providersFor(providers.resolve(request.params.exchange, request.params.symbol, request.query.assetType)) });
  });

  app.get<{ Params: { exchange: string } }>("/securities/:exchange", { schema: { summary: "Top actively traded/listed securities by exchange", tags: ["securities"], params: exchangeParam } }, async (request) => envelope(await providers.listedSecurities(request.params.exchange), { provider: "aggregate", exchange: request.params.exchange }));

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/events/:exchange/:symbol", { schema: { summary: "Exchange-aware earnings, filings, dividends, splits, and news", tags: ["events"], params: instrumentParams } }, async (request) => envelope(await providers.events(request.params.exchange, request.params.symbol, request.query.assetType), { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange }));

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { range?: string; interval?: string; indicators?: string; assetType?: string } }>("/chart/:exchange/:symbol", { schema: { summary: "Exchange-aware OHLC candles with optional indicators", tags: ["charts"], params: instrumentParams, querystring: { type: "object", properties: { range: { type: "string", default: "1y" }, interval: { type: "string", default: "1d" }, indicators: { type: "string", description: "Comma-separated: sma,rsi" }, assetType: { type: "string" } } } } }, async (request) => {
    const candles = await providers.chart(request.params.exchange, request.params.symbol, request.query.range, request.query.interval, request.query.assetType);
    const closes = candles.map((candle) => candle.close);
    const indicators = request.query.indicators?.split(",") ?? [];
    return envelope({ candles, indicators: { sma20: indicators.includes("sma") ? SMA.calculate({ period: 20, values: closes }) : undefined, rsi14: indicators.includes("rsi") ? RSI.calculate({ period: 14, values: closes }) : undefined } }, { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/financials/:exchange/:symbol", { schema: { summary: "Exchange-aware financial statements", tags: ["securities"], params: instrumentParams } }, async (request) => envelope(await providers.financials(request.params.exchange, request.params.symbol, request.query.assetType), { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange }));

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/holders/:exchange/:symbol", { schema: { summary: "Exchange-aware holder data placeholder from lightweight providers", tags: ["securities"], params: instrumentParams } }, async (request) => envelope(await providers.holders(request.params.exchange, request.params.symbol, request.query.assetType), { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange }));

  app.get<{ Querystring: { q: string } }>("/search", { schema: { summary: "Universal search across exchanges and asset classes", tags: ["search"], querystring: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } }, async (request, reply) => {
    if (!request.query.q || request.query.q.length < 2) return reply.status(400).send({ error: { message: "q must be at least 2 characters", statusCode: 400 } });
    return envelope(await providers.search(request.query.q), { provider: "aggregate", fallbackProviders: ["yahoo", "coingecko", "financeapi"] });
  });

  app.get("/market/indices", { schema: { summary: "Major global market and optional macro indices", tags: ["markets"] } }, async () => envelope(await providers.indices(), { provider: "aggregate", fallbackProviders: ["yahoo", "fred"] }));
  app.get<{ Querystring: { exchange?: string } }>("/market/movers", { schema: { summary: "Market movers for a requested exchange", tags: ["markets"], querystring: { type: "object", properties: { exchange: { type: "string", default: "NASDAQ" } } } } }, async (request) => envelope(await providers.movers(request.query.exchange), { provider: "aggregate", exchange: request.query.exchange ?? "NASDAQ" }));
  app.get<{ Params: { symbols: string }; Querystring: { exchange?: string } }>("/compare/:symbols", { schema: { summary: "Compare comma-separated symbols on an exchange", tags: ["markets"], params: { type: "object", properties: { symbols: { type: "string", examples: ["AAPL,MSFT,NVDA"] } }, required: ["symbols"] }, querystring: { type: "object", properties: { exchange: { type: "string", default: "NASDAQ" } } } } }, async (request) => envelope(await providers.compare(request.params.symbols, request.query.exchange), { provider: "yahoo", exchange: request.query.exchange ?? "NASDAQ" }));
  app.get("/crypto/trending", { schema: { summary: "Trending crypto assets from CoinGecko", tags: ["crypto"] } }, async () => envelope(await providers.coingecko.trending(), { provider: "coingecko", exchange: "CRYPTO", assetType: "crypto" }));
  app.get<{ Querystring: { base?: string; symbols?: string } }>("/forex/rates", { schema: { summary: "Forex spot rates", tags: ["forex"], querystring: { type: "object", properties: { base: { type: "string", default: "USD" }, symbols: { type: "string", default: "EUR,GBP,JPY,CAD,AUD,CHF" } } } } }, async (request) => envelope(await providers.forexRates(request.query.base, request.query.symbols), { provider: "yahoo", exchange: "FOREX", assetType: "forex" }));

  if (config.ENABLE_WEBSOCKET) {
    app.get("/stream/quotes", { websocket: true }, (socket) => {
      const interval = setInterval(() => socket.send(JSON.stringify({ type: "heartbeat", asOf: new Date().toISOString() })), 30_000);
      socket.on("close", () => clearInterval(interval));
    });
  }

  return app;
}
