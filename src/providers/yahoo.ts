import yahooFinance from "yahoo-finance2";
import type {
  Candle,
  MarketAsset,
  MarketEvent,
  NewsItem,
  ProviderAdapter,
  SearchResult,
  SecurityOverview
} from "../types.js";
import { fetchJson, retry, withTimeout } from "../utils/http.js";
import { normalizeSymbol } from "../utils/symbols.js";

type YahooQuote = Record<string, unknown>;
const yahoo = new yahooFinance();

function unwrapValue(value: unknown): unknown {
  if (value && typeof value === "object") {
    const wrapped = value as { raw?: unknown; fmt?: unknown; longFmt?: unknown };
    return wrapped.raw ?? wrapped.fmt ?? wrapped.longFmt ?? value;
  }

  return value;
}

function numberValue(value: unknown): number | undefined {
  const unwrapped = unwrapValue(value);
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) {
    return unwrapped;
  }

  if (typeof unwrapped === "string" && unwrapped.trim() !== "") {
    const parsed = Number(unwrapped.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  const unwrapped = unwrapValue(value);
  return typeof unwrapped === "string" && unwrapped.length > 0 ? unwrapped : undefined;
}

function dateValue(value: unknown): string | undefined {
  const unwrapped = unwrapValue(value);
  const date =
    typeof unwrapped === "number"
      ? new Date(unwrapped * 1000)
      : typeof unwrapped === "string"
        ? new Date(unwrapped)
        : unwrapped instanceof Date
          ? unwrapped
          : undefined;

  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function assetFromQuote(quote: YahooQuote): MarketAsset {
  return {
    symbol: stringValue(quote.symbol) ?? "",
    name: stringValue(quote.shortName) ?? stringValue(quote.longName),
    exchange: stringValue(quote.fullExchangeName) ?? stringValue(quote.exchange),
    price: numberValue(quote.regularMarketPrice),
    change: numberValue(quote.regularMarketChange),
    changePercent: numberValue(quote.regularMarketChangePercent),
    volume: numberValue(quote.regularMarketVolume),
    marketCap: numberValue(quote.marketCap),
    type: stringValue(quote.quoteType)
  };
}

function newsFromItems(items: Array<Record<string, unknown>> = []): NewsItem[] {
  return items.map((item) => ({
    title: stringValue(item.title) ?? "Untitled",
    url: stringValue(item.link),
    publisher: stringValue(item.publisher),
    publishedAt:
      typeof item.providerPublishTime === "number"
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : undefined,
    provider: "yahoo"
  }));
}

export class YahooAdapter implements ProviderAdapter {
  readonly name = "yahoo" as const;

  async quote(symbol: string, exchange?: string): Promise<YahooQuote> {
    const normalized = normalizeSymbol(symbol, exchange);
    return retry(this.name, () => withTimeout(() => yahoo.quote(normalized) as Promise<YahooQuote>));
  }

  async securityOverview(symbol: string, exchange?: string): Promise<SecurityOverview> {
    const normalized = normalizeSymbol(symbol, exchange);
    const modules = [
      "price",
      "summaryProfile",
      "assetProfile",
      "summaryDetail",
      "defaultKeyStatistics",
      "financialData",
      "incomeStatementHistory",
      "incomeStatementHistoryQuarterly",
      "cashflowStatementHistory",
      "calendarEvents",
      "secFilings",
      "upgradeDowngradeHistory"
    ] as const;

    const [quoteSummary, chart, news] = await Promise.all([
      this.quoteSummary(normalized, modules),
      this.chart(normalized, "1y", "1d").catch(() => []),
      this.news(normalized).catch(() => [])
    ]);

    const price = quoteSummary.price ?? {};
    const summaryDetail = quoteSummary.summaryDetail ?? {};
    const keyStats = quoteSummary.defaultKeyStatistics ?? {};
    const financialData = quoteSummary.financialData ?? {};
    const profile = quoteSummary.assetProfile ?? quoteSummary.summaryProfile ?? {};
    const events = this.eventsFromSummary(quoteSummary);
    const latest = chart.at(-1);
    const first = chart[0];

    return {
      symbol: normalized,
      exchange: stringValue(price.exchangeName) ?? exchange,
      price: {
        regularMarketPrice: numberValue(price.regularMarketPrice) ?? latest?.close,
        previousClose: numberValue(summaryDetail.previousClose),
        currency: stringValue(price.currency),
        marketState: stringValue(price.marketState),
        exchange: stringValue(price.exchangeName),
        sourceTime: new Date().toISOString()
      },
      fundamentals: {
        marketCap: numberValue(price.marketCap) ?? numberValue(summaryDetail.marketCap),
        trailingPE: numberValue(summaryDetail.trailingPE),
        forwardPE: numberValue(summaryDetail.forwardPE),
        priceToBook: numberValue(keyStats.priceToBook),
        returnOnEquity: numberValue(financialData.returnOnEquity),
        returnOnCapitalEmployed: undefined,
        dividendYield: numberValue(summaryDetail.dividendYield),
        beta: numberValue(summaryDetail.beta)
      },
      financials: {
        annual: this.statementRows(quoteSummary.incomeStatementHistory?.incomeStatementHistory),
        quarterly: this.statementRows(quoteSummary.incomeStatementHistoryQuarterly?.incomeStatementHistory),
        cashflow: this.statementRows(quoteSummary.cashflowStatementHistory?.cashflowStatements)
      },
      profile: {
        name: stringValue(price.longName) ?? stringValue(price.shortName),
        sector: stringValue(profile.sector),
        industry: stringValue(profile.industry),
        website: stringValue(profile.website),
        country: stringValue(profile.country),
        employees: numberValue(profile.fullTimeEmployees),
        summary: stringValue(profile.longBusinessSummary)
      },
      historicalPerformance: {
        oneYearPercent: first && latest ? ((latest.close - first.close) / first.close) * 100 : undefined
      },
      events,
      news
    };
  }

  async chart(symbol: string, range = "1y", interval = "1d"): Promise<Candle[]> {
    const normalized = normalizeSymbol(symbol);
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalized)}`);
    url.searchParams.set("range", range);
    url.searchParams.set("interval", interval);
    url.searchParams.set("includePrePost", "false");
    url.searchParams.set("events", "div,splits");
    const result = await fetchJson<{
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: number[];
              high?: number[];
              low?: number[];
              close?: number[];
              volume?: number[];
            }>;
          };
        }>;
      };
    }>(this.name, url);
    const chart = result.chart?.result?.[0];
    const quote = chart?.indicators?.quote?.[0];

    return (chart?.timestamp ?? [])
      .map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString(),
        open: quote?.open?.[index] ?? 0,
        high: quote?.high?.[index] ?? 0,
        low: quote?.low?.[index] ?? 0,
        close: quote?.close?.[index] ?? 0,
        volume: quote?.volume?.[index]
      }))
      .filter((candle) => candle.open && candle.high && candle.low && candle.close);
  }

  private async quoteSummary(symbol: string, modules: readonly string[]): Promise<Record<string, any>> {
    const url = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
    url.searchParams.set("modules", modules.join(","));
    url.searchParams.set("formatted", "false");
    const result = await fetchJson<{ quoteSummary?: { result?: Record<string, any>[]; error?: unknown } }>(this.name, url);
    return result.quoteSummary?.result?.[0] ?? {};
  }

  private async quoteBatch(symbols: string[]): Promise<YahooQuote[]> {
    const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("formatted", "false");
    const result = await fetchJson<{ quoteResponse?: { result?: YahooQuote[] } }>(this.name, url);
    return result.quoteResponse?.result ?? [];
  }

  private async rawSearch(query: string, quotesCount: number, newsCount: number): Promise<Record<string, any>> {
    const url = new URL("https://query2.finance.yahoo.com/v1/finance/search");
    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", String(quotesCount));
    url.searchParams.set("newsCount", String(newsCount));
    return fetchJson<Record<string, any>>(this.name, url);
  }

  async search(query: string): Promise<SearchResult[]> {
    const result = await this.rawSearch(query, 10, 0);

    return (result.quotes ?? []).map((quote: YahooQuote) => ({
      symbol: stringValue(quote.symbol) ?? "",
      name: stringValue(quote.shortname) ?? stringValue(quote.longname),
      exchange: stringValue(quote.exchDisp) ?? stringValue(quote.exchange),
      type: stringValue(quote.quoteType),
      provider: this.name
    }));
  }

  async screener(scrId: "day_gainers" | "day_losers" | "most_actives" | "trending_tickers", count = 25): Promise<MarketAsset[]> {
    const url = new URL("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved");
    url.searchParams.set("scrIds", scrId);
    url.searchParams.set("count", String(count));
    url.searchParams.set("formatted", "false");
    const result = await fetchJson<Record<string, any>>(this.name, url);
    const quotes = result.finance?.result?.[0]?.quotes ?? [];
    return quotes.map(assetFromQuote);
  }

  async indices(): Promise<MarketAsset[]> {
    const symbols = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^FTSE", "^N225", "^HSI"];
    const quotes = await this.quoteBatch(symbols);
    return quotes.map(assetFromQuote);
  }

  async compare(symbols: string[]): Promise<MarketAsset[]> {
    const quotes = await this.quoteBatch(symbols);
    return quotes.map(assetFromQuote);
  }

  async news(symbol: string): Promise<NewsItem[]> {
    const result = await this.rawSearch(symbol, 0, 10);
    return newsFromItems(result.news);
  }

  private statementRows(rows: Array<Record<string, any>> = []) {
    return rows.map((row) => ({
      period: dateValue(row.endDate),
      revenue: numberValue(row.totalRevenue),
      grossProfit: numberValue(row.grossProfit),
      operatingIncome: numberValue(row.operatingIncome),
      netIncome: numberValue(row.netIncome),
      totalAssets: numberValue(row.totalAssets),
      totalLiabilities: numberValue(row.totalLiab),
      cash: numberValue(row.cash),
      operatingCashflow: numberValue(row.totalCashFromOperatingActivities),
      freeCashflow: numberValue(row.freeCashflow)
    }));
  }

  private eventsFromSummary(summary: Record<string, any>): MarketEvent[] {
    const events: MarketEvent[] = [];
    const earningsDate = dateValue(summary.calendarEvents?.earnings?.earningsDate?.[0]);
    if (earningsDate) {
      events.push({
        type: "earnings",
        date: earningsDate,
        title: "Earnings date",
        provider: this.name
      });
    }

    for (const filing of summary.secFilings?.filings ?? []) {
      events.push({
        type: "filing",
        date: dateValue(filing.date),
        title: filing.type ?? "SEC filing",
        url: filing.edgarUrl,
        provider: this.name
      });
    }

    return events;
  }
}
