import { CoingeckoAdapter } from "./coingecko.js";
import { FinanceApiAdapter } from "./financeapi.js";
import { FredAdapter } from "./fred.js";
import { NewsAdapter } from "./news.js";
import { StooqAdapter } from "./stooq.js";
import { YahooAdapter } from "./yahoo.js";
import type { Candle, ForexRate, MarketAsset, MarketEvent, SearchResult, SecurityOverview } from "../types.js";
import { normalizeExchange, splitSymbols } from "../utils/symbols.js";

export class ProviderRegistry {
  readonly yahoo = new YahooAdapter();
  readonly financeapi = new FinanceApiAdapter();
  readonly coingecko = new CoingeckoAdapter();
  readonly fred = new FredAdapter();
  readonly stooq = new StooqAdapter();
  readonly news = new NewsAdapter();

  async securityOverview(symbol: string, exchange?: string): Promise<SecurityOverview> {
    try {
      return await this.yahoo.securityOverview(symbol, exchange);
    } catch (error) {
      const [quote, chart, news] = await Promise.all([
        this.stooq.quote(symbol).catch(() => undefined),
        this.stooq.chart(symbol).catch(() => []),
        this.news.financeNews(symbol).catch(() => [])
      ]);
      const latest = chart.at(-1);
      return {
        symbol: quote?.symbol ?? symbol.toUpperCase(),
        exchange: quote?.exchange ?? exchange,
        price: {
          regularMarketPrice: quote?.price ?? latest?.close,
          exchange: quote?.exchange,
          sourceTime: new Date().toISOString()
        },
        fundamentals: {},
        financials: { annual: [], quarterly: [], cashflow: [] },
        profile: { name: quote?.name },
        historicalPerformance: {},
        events: [],
        news
      };
    }
  }

  async trending(exchange: string): Promise<Record<string, MarketAsset[]>> {
    const normalizedExchange = normalizeExchange(exchange);

    if (normalizedExchange === "CRYPTO") {
      const trending = await this.coingecko.trending();
      return { trending, gainers: [], losers: [], mostTraded: [] };
    }

    const [gainers, losers, mostTraded, trending] = await Promise.all([
      this.yahoo.screener("day_gainers").catch(() => []),
      this.yahoo.screener("day_losers").catch(() => []),
      this.yahoo.screener("most_actives").catch(() => this.financeapi.movers(normalizedExchange ?? "US").catch(() => [])),
      this.yahoo.screener("trending_tickers").catch(() => [])
    ]);

    return { gainers, losers, mostTraded, trending };
  }

  async listedSecurities(exchange: string): Promise<MarketAsset[]> {
    const normalizedExchange = normalizeExchange(exchange) ?? "US";
    const screen = normalizedExchange === "CRYPTO" ? await this.coingecko.trending() : await this.yahoo.screener("most_actives", 50);
    return screen.map((asset) => ({ ...asset, exchange: asset.exchange ?? normalizedExchange }));
  }

  async events(symbol: string): Promise<MarketEvent[]> {
    const overview = await this.securityOverview(symbol);
    const newsEvents = overview.news.map<MarketEvent>((item) => ({
      type: "news",
      date: item.publishedAt,
      title: item.title,
      url: item.url,
      provider: item.provider
    }));
    return [...overview.events, ...newsEvents];
  }

  async chart(symbol: string, range?: string, interval?: string): Promise<Candle[]> {
    try {
      return await this.yahoo.chart(symbol, range, interval);
    } catch {
      return this.stooq.chart(symbol, interval === "1wk" ? "w" : "d");
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const [yahoo, coingecko, financeapi] = await Promise.all([
      this.yahoo.search(query).catch(() => []),
      this.coingecko.search(query).catch(() => []),
      this.financeapi.search(query).catch(() => [])
    ]);

    const seen = new Set<string>();
    return [...yahoo, ...coingecko, ...financeapi].filter((result) => {
      const key = `${result.provider}:${result.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async indices(): Promise<MarketAsset[]> {
    const [market, macro] = await Promise.all([this.yahoo.indices().catch(() => []), this.fred.indices().catch(() => [])]);
    return [...market, ...macro];
  }

  async movers(): Promise<Record<string, MarketAsset[]>> {
    const { gainers, losers, mostTraded } = await this.trending("US");
    return { gainers, losers, mostTraded };
  }

  async compare(symbols: string): Promise<MarketAsset[]> {
    return this.yahoo.compare(splitSymbols(symbols));
  }

  async forexRates(base = "USD", symbols = "EUR,GBP,JPY,CAD,AUD,CHF"): Promise<ForexRate[]> {
    const pairs = symbols.split(",").map((quote) => `${base}${quote}=X`);
    const quotes = await this.yahoo.compare(pairs);
    return quotes
      .filter((quote) => typeof quote.price === "number")
      .map((quote) => ({
        pair: quote.symbol.replace("=X", ""),
        rate: quote.price!,
        asOf: new Date().toISOString(),
        provider: "yahoo"
      }));
  }
}
