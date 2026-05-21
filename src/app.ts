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

function envelope<T>(
  data: T,
  meta: Omit<ApiEnvelope<T>["meta"], "asOf"> & { asOf?: string }
): ApiEnvelope<T> {
  return {
    data,
    meta: {
      ...meta,
      asOf: meta.asOf ?? new Date().toISOString()
    }
  };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info"
    }
  });
  const providers = new ProviderRegistry();

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Wise Markets API",
        description: "Lightweight adapter-based market aggregation API with normalized provider responses.",
        version: "0.1.0"
      },
      servers: [{ url: "/" }]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  if (config.ENABLE_WEBSOCKET) {
    await app.register(websocket);
  }

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const fastifyError = error as { statusCode?: number; message?: string };
    const statusCode = fastifyError.statusCode && fastifyError.statusCode >= 400 ? fastifyError.statusCode : 502;
    reply.status(statusCode).send({
      error: {
        message: fastifyError.message ?? "Provider request failed",
        statusCode
      },
      meta: {
        asOf: new Date().toISOString()
      }
    });
  });

  app.get("/health", {
    schema: {
      summary: "Health check",
      tags: ["system"]
    }
  }, async () => envelope({ ok: true }, { provider: "aggregate" }));

  app.get<{
    Params: { exchange: string };
  }>("/trending/:exchange", {
    schema: {
      summary: "Top gainers, losers, most traded, and trending assets by exchange",
      tags: ["markets"],
      params: {
        type: "object",
        properties: { exchange: { type: "string" } },
        required: ["exchange"]
      }
    }
  }, async (request) => {
    const data = await providers.trending(request.params.exchange);
    return envelope(data, {
      provider: "aggregate",
      exchange: request.params.exchange,
      fallbackProviders: ["yahoo", "financeapi", "coingecko"]
    });
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { exchange?: string };
  }>("/about/current/:symbol", {
    schema: {
      summary: "Complete security or company snapshot",
      tags: ["securities"],
      params: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"]
      },
      querystring: {
        type: "object",
        properties: { exchange: { type: "string" } }
      }
    }
  }, async (request) => {
    const data = await providers.securityOverview(request.params.symbol, request.query.exchange);
    return envelope(data, {
      provider: "aggregate",
      symbol: data.symbol,
      exchange: data.exchange,
      fallbackProviders: ["yahoo", "stooq", "news"]
    });
  });

  app.get<{
    Params: { exchange: string };
  }>("/securities/:exchange", {
    schema: {
      summary: "Top actively traded/listed securities by exchange",
      tags: ["securities"],
      params: {
        type: "object",
        properties: { exchange: { type: "string" } },
        required: ["exchange"]
      }
    }
  }, async (request) => {
    const data = await providers.listedSecurities(request.params.exchange);
    return envelope(data, { provider: "aggregate", exchange: request.params.exchange, fallbackProviders: ["yahoo", "coingecko"] });
  });

  app.get<{
    Params: { symbol: string };
  }>("/events/:symbol", {
    schema: {
      summary: "Earnings, filings, dividends, splits, and related news",
      tags: ["events"],
      params: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"]
      }
    }
  }, async (request) => envelope(await providers.events(request.params.symbol), { provider: "aggregate", symbol: request.params.symbol }));

  app.get<{
    Params: { symbol: string };
    Querystring: { range?: string; interval?: string; indicators?: string };
  }>("/chart/:symbol", {
    schema: {
      summary: "Historical OHLC candles with optional indicators",
      tags: ["charts"],
      params: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"]
      },
      querystring: {
        type: "object",
        properties: {
          range: { type: "string", default: "1y" },
          interval: { type: "string", default: "1d" },
          indicators: { type: "string", description: "Comma-separated: sma,rsi" }
        }
      }
    }
  }, async (request) => {
    const candles = await providers.chart(request.params.symbol, request.query.range, request.query.interval);
    const closes = candles.map((candle) => candle.close);
    const indicators = request.query.indicators?.split(",") ?? [];
    return envelope(
      {
        candles,
        indicators: {
          sma20: indicators.includes("sma") ? SMA.calculate({ period: 20, values: closes }) : undefined,
          rsi14: indicators.includes("rsi") ? RSI.calculate({ period: 14, values: closes }) : undefined
        }
      },
      { provider: "aggregate", symbol: request.params.symbol, fallbackProviders: ["yahoo", "stooq"] }
    );
  });

  app.get<{ Querystring: { q: string } }>("/search", {
    schema: {
      summary: "Universal search across securities and crypto assets",
      tags: ["search"],
      querystring: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"]
      }
    }
  }, async (request, reply) => {
    if (!request.query.q || request.query.q.length < 2) {
      return reply.status(400).send({ error: { message: "q must be at least 2 characters", statusCode: 400 } });
    }
    return envelope(await providers.search(request.query.q), {
      provider: "aggregate",
      fallbackProviders: ["yahoo", "coingecko", "financeapi"]
    });
  });

  app.get("/market/indices", {
    schema: {
      summary: "Major market and optional macro indices",
      tags: ["markets"]
    }
  }, async () => envelope(await providers.indices(), { provider: "aggregate", fallbackProviders: ["yahoo", "fred"] }));

  app.get("/market/movers", {
    schema: {
      summary: "US market gainers, losers, and most active assets",
      tags: ["markets"]
    }
  }, async () => envelope(await providers.movers(), { provider: "aggregate", exchange: "US", fallbackProviders: ["yahoo", "financeapi"] }));

  app.get<{ Params: { symbols: string } }>("/compare/:symbols", {
    schema: {
      summary: "Compare comma-separated symbols",
      tags: ["markets"],
      params: {
        type: "object",
        properties: { symbols: { type: "string", examples: ["AAPL,MSFT,NVDA"] } },
        required: ["symbols"]
      }
    }
  }, async (request) => envelope(await providers.compare(request.params.symbols), { provider: "yahoo" }));

  app.get("/crypto/trending", {
    schema: {
      summary: "Trending crypto assets from CoinGecko",
      tags: ["crypto"]
    }
  }, async () => envelope(await providers.coingecko.trending(), { provider: "coingecko", exchange: "CRYPTO" }));

  app.get<{ Querystring: { base?: string; symbols?: string } }>("/forex/rates", {
    schema: {
      summary: "Forex spot rates",
      tags: ["forex"],
      querystring: {
        type: "object",
        properties: {
          base: { type: "string", default: "USD" },
          symbols: { type: "string", default: "EUR,GBP,JPY,CAD,AUD,CHF" }
        }
      }
    }
  }, async (request) =>
    envelope(await providers.forexRates(request.query.base, request.query.symbols), {
      provider: "yahoo",
      exchange: "FOREX"
    })
  );

  if (config.ENABLE_WEBSOCKET) {
    app.get("/stream/quotes", { websocket: true }, (socket) => {
      const interval = setInterval(() => {
        socket.send(JSON.stringify({ type: "heartbeat", asOf: new Date().toISOString() }));
      }, 30_000);
      socket.on("close", () => clearInterval(interval));
    });
  }

  return app;
}
