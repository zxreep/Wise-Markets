import { CoingeckoAdapter } from "./coingecko.js";
import { CcxtAdapter } from "./ccxt.js";
import { FinanceApiAdapter } from "./financeapi.js";
import { FredAdapter } from "./fred.js";
import { NewsAdapter } from "./news.js";
import { StooqAdapter } from "./stooq.js";
import { YahooAdapter } from "./yahoo.js";
import type { Candle, FinancialStatementRow, ForexRate, MarketAsset, MarketEvent, NormalizedSymbol, ProviderCapability, ProviderName, SearchResult, SecurityOverview } from "../types.js";
import { listExchanges, normalizeExchange, normalizeInstrument, splitSymbols } from "../utils/symbols.js";

export class ProviderRegistry {
  readonly yahoo = new YahooAdapter();
  readonly financeapi = new FinanceApiAdapter();
  readonly coingecko = new CoingeckoAdapter();
  readonly ccxt = new CcxtAdapter();
  readonly fred = new FredAdapter();
  readonly stooq = new StooqAdapter();
  readonly news = new NewsAdapter();

  capabilities(): ProviderCapability[] {
    return [this.yahoo, this.financeapi, this.coingecko, this.ccxt, this.fred, this.stooq, this.news].map((adapter) => adapter.capabilities);
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
    if (instrument.assetType === "crypto") return ["coingecko", "news"];
    if (instrument.assetType === "macro") return ["fred"];
    return providers;
  }

  async securityOverview(exchange: string, symbol: string, assetType?: string): Promise<SecurityOverview> {
    const instrument = this.resolve(exchange, symbol, assetType);

    if (instrument.assetType === "crypto") {
      const [ticker, matches, news] = await Promise.all([
        this.ccxt.ticker(instrument.exchange, instrument.symbol).catch(() => undefined),
        this.coingecko.search(instrument.symbol).catch(() => []),
        this.news.financeNews(instrument.symbol).catch(() => [])
      ]);
      const match = matches[0];
      return { symbol: instrument.symbol, exchange: instrument.exchange, assetType: "crypto", price: { regularMarketPrice: ticker?.price, exchange: instrument.exchange, sourceTime: new Date().toISOString() }, fundamentals: {}, financials: { annual: [], quarterly: [], cashflow: [] }, profile: { name: match?.name ?? ticker?.name }, historicalPerformance: {}, events: [], news };
    }

    try {
      return await this.yahoo.securityOverview(instrument.symbol, instrument.exchange);
    } catch {
      const [quote, chart, news] = await Promise.all([
        this.stooq.quote(instrument.symbol, instrument.exchange).catch(() => undefined),
        this.stooq.chart(instrument.symbol, "d", instrument.exchange).catch(() => []),
        this.news.financeNews(instrument.canonical).catch(() => [])
      ]);
      const latest = chart.at(-1);
      return { symbol: instrument.symbol, exchange: instrument.exchange, assetType: instrument.assetType, price: { regularMarketPrice: quote?.price ?? latest?.close, exchange: instrument.exchange, sourceTime: new Date().toISOString() }, fundamentals: {}, financials: { annual: [], quarterly: [], cashflow: [] }, profile: { name: quote?.name }, historicalPerformance: {}, events: [], news };
    }
  }

  async financials(exchange: string, symbol: string, assetType?: string): Promise<SecurityOverview["financials"]> {
    return (await this.securityOverview(exchange, symbol, assetType)).financials;
  }

  async holders(exchange: string, symbol: string, assetType?: string): Promise<Array<Record<string, string | number | undefined>>> {
    const overview = await this.securityOverview(exchange, symbol, assetType);
    return [{ symbol: overview.symbol, exchange: overview.exchange, message: "Holder data is provider-dependent and unavailable from configured lightweight public adapters." }];
  }

  async trending(exchange: string): Promise<Record<string, MarketAsset[]>> {
    const normalizedExchange = normalizeExchange(exchange) ?? exchange.toUpperCase();
    if (["CRYPTO", "BINANCE", "COINBASE", "KRAKEN"].includes(normalizedExchange)) {
      const trending = await this.coingecko.trending();
      return { trending: trending.map((asset) => ({ ...asset, exchange: normalizedExchange, assetType: "crypto" })), gainers: [], losers: [], mostTraded: [] };
    }

    const [gainers, losers, mostTraded, trending] = await Promise.all([
      this.yahoo.screener("day_gainers").catch(() => []),
      this.yahoo.screener("day_losers").catch(() => []),
      this.yahoo.screener("most_actives").catch(() => this.financeapi.movers(normalizedExchange).catch(() => [])),
      this.yahoo.screener("trending_tickers").catch(() => [])
    ]);
    const tag = (assets: MarketAsset[]) => assets.map((asset) => ({ ...asset, exchange: asset.exchange ?? normalizedExchange, assetType: asset.assetType ?? "equity" as const }));
    return { gainers: tag(gainers), losers: tag(losers), mostTraded: tag(mostTraded), trending: tag(trending) };
  }

  async listedSecurities(exchange: string): Promise<MarketAsset[]> {
    const normalizedExchange = normalizeExchange(exchange) ?? exchange.toUpperCase();
    const screen = ["CRYPTO", "BINANCE", "COINBASE", "KRAKEN"].includes(normalizedExchange) ? await this.coingecko.trending() : await this.yahoo.screener("most_actives", 50);
    return screen.map((asset) => ({ ...asset, exchange: asset.exchange ?? normalizedExchange, assetType: asset.assetType ?? (normalizedExchange === "CRYPTO" ? "crypto" : "equity") }));
  }

  async events(exchange: string, symbol: string, assetType?: string): Promise<MarketEvent[]> {
    const overview = await this.securityOverview(exchange, symbol, assetType);
    const newsEvents = overview.news.map<MarketEvent>((item) => ({ type: "news", date: item.publishedAt, title: item.title, url: item.url, provider: item.provider }));
    return [...overview.events, ...newsEvents];
  }

  async chart(exchange: string, symbol: string, range?: string, interval?: string, assetType?: string): Promise<Candle[]> {
    const instrument = this.resolve(exchange, symbol, assetType);
    if (instrument.assetType === "crypto") return [];
    try {
      return await this.yahoo.chart(instrument.symbol, range, interval, instrument.exchange);
    } catch {
      return this.stooq.chart(instrument.symbol, interval === "1wk" ? "w" : "d", instrument.exchange);
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const compact = query.trim().toUpperCase().replace(/[:/\-\s]/g, "");
    const inferred: SearchResult[] = [];
    if (/^[A-Z]{6}$/.test(compact)) inferred.push({ symbol: compact, exchange: "FOREX", assetType: "forex", name: `${compact.slice(0, 3)}/${compact.slice(3)} FX rate`, provider: "yahoo" });
    if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA).*(USDT|USD)$/.test(compact)) inferred.push({ symbol: compact, exchange: "BINANCE", assetType: "crypto", name: compact, provider: "coingecko" });

    const [yahoo, coingecko, financeapi] = await Promise.all([this.yahoo.search(query).catch(() => []), this.coingecko.search(query).catch(() => []), this.financeapi.search(query).catch(() => [])]);
    const seen = new Set<string>();
    return [...inferred, ...yahoo, ...coingecko, ...financeapi].map((result) => ({ ...result, exchange: result.exchange ?? "GLOBAL", assetType: result.assetType ?? "equity" })).filter((result) => {
      const key = `${result.exchange}:${result.symbol}:${result.assetType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async indices(): Promise<MarketAsset[]> {
    const [market, macro] = await Promise.all([this.yahoo.indices().catch(() => []), this.fred.indices().catch(() => [])]);
    return [...market.map((asset) => ({ ...asset, assetType: "index" as const })), ...macro.map((asset) => ({ ...asset, assetType: "macro" as const }))];
  }

  async movers(exchange = "NASDAQ"): Promise<Record<string, MarketAsset[]>> {
    const { gainers, losers, mostTraded } = await this.trending(exchange);
    return { gainers, losers, mostTraded };
  }

  async compare(symbols: string, exchange = "NASDAQ"): Promise<MarketAsset[]> {
    return this.yahoo.compare(splitSymbols(symbols, exchange));
  }

  async forexRates(base = "USD", symbols = "EUR,GBP,JPY,CAD,AUD,CHF"): Promise<ForexRate[]> {
    const pairs = symbols.split(",").map((quote) => `${base}${quote}=X`);
    const quotes = await this.yahoo.compare(pairs);
    return quotes.filter((quote) => typeof quote.price === "number").map((quote) => ({ pair: quote.symbol.replace("=X", ""), rate: quote.price!, asOf: new Date().toISOString(), provider: "yahoo" }));
  }
}
