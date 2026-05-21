import { CoingeckoAdapter } from "./coingecko.js";
import { CcxtAdapter } from "./ccxt.js";
import { FinanceApiAdapter } from "./financeapi.js";
import { FredAdapter } from "./fred.js";
import { NewsAdapter } from "./news.js";
import { StooqAdapter } from "./stooq.js";
import { YahooAdapter } from "./yahoo.js";
import type { Candle, ForexRate, MarketAsset, MarketEvent, NormalizedSymbol, ProviderCapability, ProviderName, SearchResult, SecurityOverview } from "../types.js";
import { cache, cacheKey } from "../utils/cache.js";
import { listExchanges, normalizeExchange, normalizeInstrument, splitSymbols } from "../utils/symbols.js";

export interface Wrapped<T> {
  data: T;
  cached?: boolean;
  partial?: boolean;
  missingFields?: string[];
}

const TTL = {
  trending: 5 * 60_000,
  securityOverview: 3 * 60_000,
  chart: 10 * 60_000,
  indices: 5 * 60_000,
  movers: 3 * 60_000,
  search: 10 * 60_000,
  forexRates: 2 * 60_000,
  listedSecurities: 10 * 60_000,
  events: 3 * 60_000,
  financials: 10 * 60_000,
  holders: 15 * 60_000
} as const;

const CRYPTO_EXCHANGES = new Set(["CRYPTO", "BINANCE", "COINBASE", "KRAKEN"]);

const RANGE_TO_DAYS: Record<string, number | "max"> = {
  "1d": 1,
  "5d": 5,
  "1mo": 30,
  "3mo": 90,
  "6mo": 180,
  ytd: 0,
  "1y": 365,
  "2y": 730,
  "5y": 1825,
  "10y": 3650,
  max: "max"
};

function cryptoDays(range = "1y"): number | "max" {
  if (range === "ytd") {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime();
    return Math.max(1, Math.floor((Date.now() - start) / (24 * 60 * 60 * 1000)));
  }
  return RANGE_TO_DAYS[range] ?? 365;
}

async function withCache<T>(key: string, ttlMs: number, fetcher: () => Promise<Wrapped<T>>): Promise<Wrapped<T>> {
  const hit = cache.get<Wrapped<T>>(key);
  if (hit) return { ...hit, cached: true };
  const fresh = await fetcher();
  cache.set(key, { ...fresh, cached: false }, ttlMs);
  return fresh;
}

export class ProviderRegistry {
  readonly yahoo = new YahooAdapter();
  readonly financeapi = new FinanceApiAdapter();
  readonly coingecko = new CoingeckoAdapter();
  readonly ccxt = new CcxtAdapter();
  readonly fred = new FredAdapter();
  readonly stooq = new StooqAdapter();
  readonly news = new NewsAdapter();

  capabilities(): ProviderCapability[] {
    return [this.yahoo, this.coingecko, this.ccxt, this.fred, this.stooq, this.news, this.financeapi].map((adapter) => adapter.capabilities);
  }

  exchanges() {
    return listExchanges();
  }

  resolve(exchange: string, symbol: string, assetType?: string): NormalizedSymbol {
    return normalizeInstrument(exchange, symbol, assetType);
  }

  providersFor(instrument: NormalizedSymbol): ProviderName[] {
    const exchange = listExchanges().find((item) => item.code === instrument.exchange);
    const providers = exchange?.defaultProviders ?? ["yahoo", "stooq", "news"];
    if (instrument.assetType === "crypto") return ["coingecko", "ccxt", "news"];
    if (instrument.assetType === "macro") return ["fred"];
    return providers.filter((provider) => provider !== "financeapi");
  }

  async securityOverview(exchange: string, symbol: string, assetType?: string): Promise<Wrapped<SecurityOverview>> {
    const instrument = this.resolve(exchange, symbol, assetType);
    const key = cacheKey("securityOverview", instrument.exchange, instrument.symbol, instrument.assetType);
    return withCache(key, TTL.securityOverview, async () => {
      if (instrument.assetType === "crypto") {
        const [ticker, matches, news] = await Promise.all([
          this.ccxt.ticker(instrument.exchange, instrument.symbol).catch(() => undefined),
          this.coingecko.search(instrument.symbol).catch(() => []),
          this.news.financeNews(instrument.symbol).catch(() => [])
        ]);
        const match = matches[0];
        const missingFields: string[] = [];
        if (!ticker?.price) missingFields.push("price.regularMarketPrice");
        if (!match?.name) missingFields.push("profile.name");
        const overview: SecurityOverview = {
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          assetType: "crypto",
          price: { regularMarketPrice: ticker?.price, exchange: instrument.exchange, sourceTime: new Date().toISOString() },
          fundamentals: {},
          financials: { annual: [], quarterly: [], cashflow: [] },
          profile: { name: match?.name },
          historicalPerformance: {},
          events: [],
          news
        };
        return { data: overview, partial: missingFields.length > 0, missingFields };
      }

      try {
        const result = await this.yahoo.securityOverviewDetailed(instrument.symbol, instrument.exchange);
        return { data: result.overview, partial: result.partial, missingFields: result.missingFields };
      } catch {
        const [quote, chart, news] = await Promise.all([
          this.stooq.quote(instrument.symbol, instrument.exchange).catch(() => undefined),
          this.stooq.chart(instrument.symbol, "d", instrument.exchange).catch(() => []),
          this.news.financeNews(instrument.canonical).catch(() => [])
        ]);
        const latest = chart.at(-1);
        const overview: SecurityOverview = {
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          assetType: instrument.assetType,
          price: { regularMarketPrice: quote?.price ?? latest?.close, exchange: instrument.exchange, sourceTime: new Date().toISOString() },
          fundamentals: {},
          financials: { annual: [], quarterly: [], cashflow: [] },
          profile: { name: quote?.name },
          historicalPerformance: {},
          events: [],
          news
        };
        const missingFields = ["fundamentals", "financials", "events", "profile.sector", "profile.industry"];
        return { data: overview, partial: true, missingFields };
      }
    });
  }

  async financials(exchange: string, symbol: string, assetType?: string): Promise<Wrapped<SecurityOverview["financials"]>> {
    const overview = await this.securityOverview(exchange, symbol, assetType);
    return { data: overview.data.financials, cached: overview.cached, partial: overview.partial, missingFields: overview.missingFields };
  }

  async holders(exchange: string, symbol: string, assetType?: string): Promise<Wrapped<{
    majorHolders: Record<string, unknown>;
    institutionalOwnership: Array<Record<string, unknown>>;
    fundOwnership: Array<Record<string, unknown>>;
  }>> {
    const instrument = this.resolve(exchange, symbol, assetType);
    const key = cacheKey("holders", instrument.exchange, instrument.symbol);
    return withCache(key, TTL.holders, async () => {
      try {
        const data = await this.yahoo.holders(instrument.symbol, instrument.exchange);
        return { data, partial: false };
      } catch {
        return {
          data: { majorHolders: {}, institutionalOwnership: [], fundOwnership: [] },
          partial: true,
          missingFields: ["majorHolders", "institutionalOwnership", "fundOwnership"]
        };
      }
    });
  }

  async trending(exchange: string): Promise<Wrapped<Record<string, MarketAsset[]>>> {
    const normalizedExchange = normalizeExchange(exchange) ?? exchange.toUpperCase();
    const key = cacheKey("trending", normalizedExchange);
    return withCache(key, TTL.trending, async () => {
      if (CRYPTO_EXCHANGES.has(normalizedExchange)) {
        const trending = await this.coingecko.trending().catch(() => []);
        const tagged = trending.map((asset) => ({ ...asset, exchange: normalizedExchange, assetType: "crypto" as const }));
        return { data: { trending: tagged, gainers: [], losers: [], mostTraded: [] }, partial: trending.length === 0, missingFields: trending.length === 0 ? ["trending"] : undefined };
      }

      const [gainers, losers, mostTraded, trendingRaw] = await Promise.all([
        this.yahoo.screener("day_gainers").catch(() => []),
        this.yahoo.screener("day_losers").catch(() => []),
        this.yahoo.screener("most_actives").catch(() => []),
        this.yahoo.screener("trending_tickers").catch(() => [])
      ]);

      const tag = (assets: MarketAsset[]) =>
        assets.map((asset) => ({ ...asset, exchange: asset.exchange ?? normalizedExchange, assetType: asset.assetType ?? ("equity" as const) }));

      const trending = trendingRaw.length > 0 ? tag(trendingRaw) : tag(mostTraded).slice(0, 10);
      const missingFields: string[] = [];
      if (gainers.length === 0) missingFields.push("gainers");
      if (losers.length === 0) missingFields.push("losers");
      if (mostTraded.length === 0) missingFields.push("mostTraded");
      if (trendingRaw.length === 0 && mostTraded.length === 0) missingFields.push("trending");

      return {
        data: { gainers: tag(gainers), losers: tag(losers), mostTraded: tag(mostTraded), trending },
        partial: missingFields.length > 0,
        missingFields: missingFields.length > 0 ? missingFields : undefined
      };
    });
  }

  async listedSecurities(exchange: string): Promise<Wrapped<MarketAsset[]>> {
    const normalizedExchange = normalizeExchange(exchange) ?? exchange.toUpperCase();
    const key = cacheKey("listedSecurities", normalizedExchange);
    return withCache(key, TTL.listedSecurities, async () => {
      const isCrypto = CRYPTO_EXCHANGES.has(normalizedExchange);
      const screen = isCrypto
        ? await this.coingecko.trending().catch(() => [])
        : await this.yahoo.screener("most_actives", 50).catch(() => []);
      const data = screen.map((asset) => ({
        ...asset,
        exchange: asset.exchange ?? normalizedExchange,
        assetType: asset.assetType ?? (isCrypto ? "crypto" : "equity")
      }));
      return { data, partial: data.length === 0, missingFields: data.length === 0 ? ["securities"] : undefined };
    });
  }

  async events(exchange: string, symbol: string, assetType?: string): Promise<Wrapped<MarketEvent[]>> {
    const overview = await this.securityOverview(exchange, symbol, assetType);
    const newsEvents = overview.data.news.map<MarketEvent>((item) => ({
      type: "news",
      date: item.publishedAt,
      title: item.title,
      url: item.url,
      provider: item.provider
    }));
    return {
      data: [...overview.data.events, ...newsEvents],
      cached: overview.cached,
      partial: overview.partial,
      missingFields: overview.missingFields
    };
  }

  async chart(exchange: string, symbol: string, range?: string, interval?: string, assetType?: string): Promise<Wrapped<Candle[]>> {
    const instrument = this.resolve(exchange, symbol, assetType);
    const key = cacheKey("chart", instrument.exchange, instrument.symbol, instrument.assetType, range, interval);
    return withCache(key, TTL.chart, async () => {
      if (instrument.assetType === "crypto") {
        const coinId = await this.coingecko.resolveCoinId(instrument.symbol).catch(() => undefined);
        if (!coinId) return { data: [], partial: true, missingFields: ["candles"] };
        const candles = await this.coingecko.chart(coinId, cryptoDays(range)).catch(() => []);
        return { data: candles, partial: candles.length === 0, missingFields: candles.length === 0 ? ["candles"] : undefined };
      }

      try {
        const candles = await this.yahoo.chart(instrument.symbol, range, interval, instrument.exchange);
        if (candles.length > 0) return { data: candles, partial: false };
      } catch {
        /* fall through to Stooq */
      }
      const stooq = await this.stooq.chart(instrument.symbol, interval === "1wk" ? "w" : "d", instrument.exchange).catch(() => []);
      return { data: stooq, partial: stooq.length === 0, missingFields: stooq.length === 0 ? ["candles"] : undefined };
    });
  }

  async search(query: string): Promise<Wrapped<SearchResult[]>> {
    const key = cacheKey("search", query.trim().toLowerCase());
    return withCache(key, TTL.search, async () => {
      const compact = query.trim().toUpperCase().replace(/[:/\-\s]/g, "");
      const inferred: SearchResult[] = [];
      if (/^[A-Z]{6}$/.test(compact)) {
        inferred.push({ symbol: compact, exchange: "FOREX", assetType: "forex", name: `${compact.slice(0, 3)}/${compact.slice(3)} FX rate`, provider: "yahoo" });
      }
      if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA).*(USDT|USD)$/.test(compact)) {
        inferred.push({ symbol: compact, exchange: "BINANCE", assetType: "crypto", name: compact, provider: "coingecko" });
      }

      const [yahoo, coingecko] = await Promise.all([
        this.yahoo.search(query).catch(() => []),
        this.coingecko.search(query).catch(() => [])
      ]);

      const seen = new Set<string>();
      const data = [...inferred, ...yahoo, ...coingecko]
        .map((result) => ({ ...result, exchange: result.exchange ?? "GLOBAL", assetType: result.assetType ?? "equity" }))
        .filter((result) => {
          const idKey = `${result.exchange}:${result.symbol}:${result.assetType}`;
          if (seen.has(idKey)) return false;
          seen.add(idKey);
          return true;
        });
      return { data, partial: data.length === 0, missingFields: data.length === 0 ? ["results"] : undefined };
    });
  }

  async indices(): Promise<Wrapped<MarketAsset[]>> {
    return withCache(cacheKey("indices"), TTL.indices, async () => {
      const [market, macro] = await Promise.all([
        this.yahoo.indices().catch(() => []),
        this.fred.indices().catch(() => [])
      ]);
      const data = [
        ...market.map((asset) => ({ ...asset, assetType: "index" as const })),
        ...macro.map((asset) => ({ ...asset, assetType: "macro" as const }))
      ];
      const missing: string[] = [];
      if (market.length === 0) missing.push("marketIndices");
      if (macro.length === 0) missing.push("macroIndicators");
      return { data, partial: missing.length > 0, missingFields: missing.length > 0 ? missing : undefined };
    });
  }

  async movers(exchange = "NASDAQ"): Promise<Wrapped<Record<string, MarketAsset[]>>> {
    const normalizedExchange = normalizeExchange(exchange) ?? exchange.toUpperCase();
    const key = cacheKey("movers", normalizedExchange);
    return withCache(key, TTL.movers, async () => {
      const trending = await this.trending(normalizedExchange);
      const { gainers, losers, mostTraded } = trending.data;
      return { data: { gainers, losers, mostTraded }, partial: trending.partial, missingFields: trending.missingFields };
    });
  }

  async compare(symbols: string, exchange = "NASDAQ"): Promise<Wrapped<MarketAsset[]>> {
    const normalized = splitSymbols(symbols, exchange);
    const data = await this.yahoo.compare(normalized).catch(() => []);
    return { data, partial: data.length === 0, missingFields: data.length === 0 ? ["quotes"] : undefined };
  }

  async forexRates(base = "USD", symbols = "EUR,GBP,JPY,CAD,AUD,CHF"): Promise<Wrapped<ForexRate[]>> {
    const key = cacheKey("forexRates", base, symbols);
    return withCache(key, TTL.forexRates, async () => {
      const pairs = symbols.split(",").map((quote) => `${base}${quote}=X`);
      const quotes = await this.yahoo.compare(pairs).catch(() => []);
      const data: ForexRate[] = quotes
        .filter((quote) => typeof quote.price === "number")
        .map((quote) => ({ pair: quote.symbol.replace("=X", ""), rate: quote.price as number, asOf: new Date().toISOString(), provider: "yahoo" }));
      return { data, partial: data.length === 0, missingFields: data.length === 0 ? ["rates"] : undefined };
    });
  }
}
