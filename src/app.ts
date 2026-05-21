import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { SMA, RSI } from "technicalindicators";
import { config } from "./config.js";
import { ProviderRegistry, type Wrapped } from "./providers/index.js";
import type { ApiEnvelope } from "./types.js";

type EnvelopeMeta = ApiEnvelope<unknown>["meta"];

function envelopeFromWrapped<T>(
  wrapped: Wrapped<T>,
  baseMeta: Omit<EnvelopeMeta, "asOf"> & { asOf?: string }
): ApiEnvelope<T> {
  const meta: EnvelopeMeta = {
    ...baseMeta,
    asOf: baseMeta.asOf ?? new Date().toISOString(),
    cached: wrapped.cached
  };
  if (wrapped.partial) meta.partial = true;
  if (wrapped.missingFields && wrapped.missingFields.length > 0) meta.missingFields = wrapped.missingFields;
  return { data: wrapped.data, meta };
}

function envelope<T>(data: T, baseMeta: Omit<EnvelopeMeta, "asOf"> & { asOf?: string }): ApiEnvelope<T> {
  return { data, meta: { ...baseMeta, asOf: baseMeta.asOf ?? new Date().toISOString() } };
}

const exchangeParam = { type: "object", properties: { exchange: { type: "string" } }, required: ["exchange"] };
const instrumentParams = { type: "object", properties: { exchange: { type: "string" }, symbol: { type: "string" } }, required: ["exchange", "symbol"] };

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.NODE_ENV === "test" ? "silent" : "info" } });
  const providers = new ProviderRegistry();

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW });
  await app.register(swagger, { openapi: { info: { title: "Wise Markets API", description: "Global exchange-aware market aggregation API with provider capability routing and TTL caching.", version: "0.3.0" }, servers: [{ url: "/" }] } });
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
    const wrapped = await providers.trending(request.params.exchange);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", exchange: request.params.exchange, fallbackProviders: ["yahoo", "coingecko", "stooq"] });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/about/current/:exchange/:symbol", { schema: { summary: "Exchange-aware security/company snapshot", tags: ["securities"], params: instrumentParams, querystring: { type: "object", properties: { assetType: { type: "string" } } } } }, async (request) => {
    const wrapped = await providers.securityOverview(request.params.exchange, request.params.symbol, request.query.assetType);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", symbol: wrapped.data.symbol, exchange: wrapped.data.exchange, assetType: wrapped.data.assetType, fallbackProviders: providers.providersFor(providers.resolve(request.params.exchange, request.params.symbol, request.query.assetType)) });
  });

  app.get<{ Params: { exchange: string } }>("/securities/:exchange", { schema: { summary: "Top actively traded/listed securities by exchange", tags: ["securities"], params: exchangeParam } }, async (request) => {
    const wrapped = await providers.listedSecurities(request.params.exchange);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", exchange: request.params.exchange });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/events/:exchange/:symbol", { schema: { summary: "Exchange-aware earnings, filings, dividends, splits, and news", tags: ["events"], params: instrumentParams } }, async (request) => {
    const wrapped = await providers.events(request.params.exchange, request.params.symbol, request.query.assetType);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { range?: string; interval?: string; indicators?: string; assetType?: string } }>("/chart/:exchange/:symbol", { schema: { summary: "Exchange-aware OHLC candles with optional indicators", tags: ["charts"], params: instrumentParams, querystring: { type: "object", properties: { range: { type: "string", default: "1y" }, interval: { type: "string", default: "1d" }, indicators: { type: "string", description: "Comma-separated: sma,rsi" }, assetType: { type: "string" } } } } }, async (request) => {
    const wrapped = await providers.chart(request.params.exchange, request.params.symbol, request.query.range, request.query.interval, request.query.assetType);
    const closes = wrapped.data.map((candle) => candle.close);
    const indicators = request.query.indicators?.split(",") ?? [];
    const data = {
      candles: wrapped.data,
      indicators: {
        sma20: indicators.includes("sma") ? SMA.calculate({ period: 20, values: closes }) : undefined,
        rsi14: indicators.includes("rsi") ? RSI.calculate({ period: 14, values: closes }) : undefined
      }
    };
    return envelopeFromWrapped({ ...wrapped, data }, { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/financials/:exchange/:symbol", { schema: { summary: "Exchange-aware financial statements", tags: ["securities"], params: instrumentParams } }, async (request) => {
    const wrapped = await providers.financials(request.params.exchange, request.params.symbol, request.query.assetType);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", symbol: request.params.symbol, exchange: request.params.exchange });
  });

  app.get<{ Params: { exchange: string; symbol: string }; Querystring: { assetType?: string } }>("/holders/:exchange/:symbol", { schema: { summary: "Major and institutional holders breakdown", tags: ["securities"], params: instrumentParams } }, async (request) => {
    const wrapped = await providers.holders(request.params.exchange, request.params.symbol, request.query.assetType);
    return envelopeFromWrapped(wrapped, { provider: "yahoo", symbol: request.params.symbol, exchange: request.params.exchange });
  });

  app.get<{ Querystring: { q: string } }>("/search", { schema: { summary: "Universal search across exchanges and asset classes", tags: ["search"], querystring: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } }, async (request, reply) => {
    if (!request.query.q || request.query.q.length < 2) return reply.status(400).send({ error: { message: "q must be at least 2 characters", statusCode: 400 } });
    const wrapped = await providers.search(request.query.q);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", fallbackProviders: ["yahoo", "coingecko"] });
  });

  app.get("/market/indices", { schema: { summary: "Major global market and optional macro indices", tags: ["markets"] } }, async () => {
    const wrapped = await providers.indices();
    return envelopeFromWrapped(wrapped, { provider: "aggregate", fallbackProviders: ["yahoo", "fred"] });
  });

  app.get<{ Querystring: { exchange?: string } }>("/market/movers", { schema: { summary: "Market movers for a requested exchange", tags: ["markets"], querystring: { type: "object", properties: { exchange: { type: "string", default: "NASDAQ" } } } } }, async (request) => {
    const wrapped = await providers.movers(request.query.exchange);
    return envelopeFromWrapped(wrapped, { provider: "aggregate", exchange: request.query.exchange ?? "NASDAQ" });
  });

  app.get<{ Params: { symbols: string }; Querystring: { exchange?: string } }>("/compare/:symbols", { schema: { summary: "Compare comma-separated symbols on an exchange", tags: ["markets"], params: { type: "object", properties: { symbols: { type: "string", examples: ["AAPL,MSFT,NVDA"] } }, required: ["symbols"] }, querystring: { type: "object", properties: { exchange: { type: "string", default: "NASDAQ" } } } } }, async (request) => {
    const wrapped = await providers.compare(request.params.symbols, request.query.exchange);
    return envelopeFromWrapped(wrapped, { provider: "yahoo", exchange: request.query.exchange ?? "NASDAQ" });
  });

  app.get("/crypto/trending", { schema: { summary: "Trending crypto assets from CoinGecko", tags: ["crypto"] } }, async () => envelope(await providers.coingecko.trending(), { provider: "coingecko", exchange: "CRYPTO", assetType: "crypto" }));

  app.get<{ Querystring: { base?: string; symbols?: string } }>("/forex/rates", { schema: { summary: "Forex spot rates", tags: ["forex"], querystring: { type: "object", properties: { base: { type: "string", default: "USD" }, symbols: { type: "string", default: "EUR,GBP,JPY,CAD,AUD,CHF" } } } } }, async (request) => {
    const wrapped = await providers.forexRates(request.query.base, request.query.symbols);
    return envelopeFromWrapped(wrapped, { provider: "yahoo", exchange: "FOREX", assetType: "forex" });
  });

  if (config.ENABLE_WEBSOCKET) {
    app.get("/stream/quotes", { websocket: true }, (socket) => {
      const interval = setInterval(() => socket.send(JSON.stringify({ type: "heartbeat", asOf: new Date().toISOString() })), 30_000);
      socket.on("close", () => clearInterval(interval));
    });
  }

  return app;
}
