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
import { ProviderError, retry, withTimeout } from "../utils/http.js";
import {
  assetTypeFromYahoo,
  exchangeFromYahoo,
  normalizeExchange,
  normalizeInstrument,
  normalizeSymbol
} from "../utils/symbols.js";

type YahooQuote = Record<string, unknown>;

try {
  yahooFinance.suppressNotices?.(["yahooSurvey", "ripHistorical"]);
} catch {
  /* older versions ignore */
}

function unwrapValue(value: unknown): unknown {
  if (value && typeof value === "object") {
    const wrapped = value as { raw?: unknown; fmt?: unknown; longFmt?: unknown };
    return wrapped.raw ?? wrapped.fmt ?? wrapped.longFmt ?? value;
  }
  return value;
}

function numberValue(value: unknown): number | undefined {
  const unwrapped = unwrapValue(value);
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) return unwrapped;
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
      ? new Date(unwrapped > 1e12 ? unwrapped : unwrapped * 1000)
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
    exchange: exchangeFromYahoo(stringValue(quote.exchange)) ?? stringValue(quote.fullExchangeName) ?? stringValue(quote.exchange),
    assetType: assetTypeFromYahoo(stringValue(quote.quoteType)),
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

const RANGE_DAYS: Record<string, number | "max"> = {
  "1d": 1,
  "5d": 5,
  "1mo": 31,
  "3mo": 93,
  "6mo": 186,
  ytd: 0,
  "1y": 366,
  "2y": 732,
  "5y": 1830,
  "10y": 3660,
  max: "max"
};

function rangeToPeriod1(range: string): Date {
  const today = new Date();
  if (range === "max") return new Date(1970, 0, 1);
  if (range === "ytd") return new Date(today.getFullYear(), 0, 1);
  const days = RANGE_DAYS[range] ?? 366;
  if (days === "max") return new Date(1970, 0, 1);
  const period = new Date(today);
  period.setDate(period.getDate() - Number(days));
  return period;
}

const FULL_MODULES = [
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

const LIGHT_MODULES = ["price", "summaryProfile", "defaultKeyStatistics"] as const;

const HOLDER_MODULES = ["majorHoldersBreakdown", "institutionOwnership", "fundOwnership"] as const;

export interface YahooOverviewResult {
  overview: SecurityOverview;
  partial: boolean;
  missingFields: string[];
}

export class YahooAdapter implements ProviderAdapter {
  readonly name = "yahoo" as const;
  readonly capabilities = {
    provider: this.name,
    supports: {
      markets: ["NYSE", "NASDAQ", "AMEX", "NSE", "BSE", "LSE", "EURONEXT", "XETRA", "TSE", "HKEX", "SSE", "SZSE", "ASX", "TSX", "FOREX", "COMMODITIES"],
      assetTypes: ["equity", "etf", "index", "forex", "commodity", "mutual_fund"]
    },
    symbolRules: {
      input: "EXCHANGE:SYMBOL",
      providerFormat: "Yahoo suffix format",
      examples: ["NASDAQ:AAPL", "NSE:RELIANCE", "FOREX:EURUSD"]
    },
    fallbackMappings: { stooq: "Stooq exchange suffix format", news: "related finance news" }
  } as const;

  async quote(symbol: string, exchange?: string): Promise<YahooQuote> {
    const normalized = normalizeSymbol(symbol, exchange);
    return retry(this.name, () =>
      withTimeout(() => yahooFinance.quote(normalized) as unknown as Promise<YahooQuote>)
    );
  }

  async securityOverview(symbol: string, exchange?: string): Promise<SecurityOverview> {
    return (await this.securityOverviewDetailed(symbol, exchange)).overview;
  }

  async securityOverviewDetailed(symbol: string, exchange?: string): Promise<YahooOverviewResult> {
    const instrument = normalizeInstrument(exchange ?? "NASDAQ", symbol);
    const normalized = instrument.providerSymbols.yahoo ?? normalizeSymbol(symbol, exchange);
    const missingFields: string[] = [];

    let quoteSummary: Record<string, any> = {};
    let usedLight = false;

    try {
      quoteSummary = await retry(this.name, () =>
        withTimeout(() =>
          yahooFinance.quoteSummary(normalized, {
            modules: [...FULL_MODULES]
          }) as Promise<Record<string, any>>
        )
      );
    } catch (error) {
      try {
        quoteSummary = await retry(this.name, () =>
          withTimeout(() =>
            yahooFinance.quoteSummary(normalized, {
              modules: [...LIGHT_MODULES]
            }) as Promise<Record<string, any>>
          )
        );
        usedLight = true;
        missingFields.push("financials.annual", "financials.quarterly", "financials.cashflow", "events");
      } catch {
        throw error;
      }
    }

    const [chart, news] = await Promise.all([
      this.chart(normalized, "1y", "1d").catch(() => {
        missingFields.push("historicalPerformance");
        return [] as Candle[];
      }),
      this.news(normalized).catch(() => {
        missingFields.push("news");
        return [] as NewsItem[];
      })
    ]);

    const price = quoteSummary.price ?? {};
    const summaryDetail = quoteSummary.summaryDetail ?? {};
    const keyStats = quoteSummary.defaultKeyStatistics ?? {};
    const financialData = quoteSummary.financialData ?? {};
    const profile = quoteSummary.assetProfile ?? quoteSummary.summaryProfile ?? {};
    const events = usedLight ? [] : this.eventsFromSummary(quoteSummary);
    const latest = chart.at(-1);
    const first = chart[0];

    const annual = usedLight ? [] : this.statementRows(quoteSummary.incomeStatementHistory?.incomeStatementHistory);
    const quarterly = usedLight ? [] : this.statementRows(quoteSummary.incomeStatementHistoryQuarterly?.incomeStatementHistory);
    const cashflow = usedLight ? [] : this.statementRows(quoteSummary.cashflowStatementHistory?.cashflowStatements);

    const overview: SecurityOverview = {
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      assetType: instrument.assetType,
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
      financials: { annual, quarterly, cashflow },
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

    if (!overview.price.regularMarketPrice) missingFields.push("price.regularMarketPrice");
    if (!overview.profile.name) missingFields.push("profile.name");

    return { overview, partial: missingFields.length > 0, missingFields };
  }

  async chart(symbol: string, range = "1y", interval = "1d", exchange = "NASDAQ"): Promise<Candle[]> {
    const normalized = normalizeInstrument(exchange, symbol).providerSymbols.yahoo ?? normalizeSymbol(symbol, exchange);
    const period1 = rangeToPeriod1(range);
    const result = await retry(this.name, () =>
      withTimeout(() =>
        yahooFinance.chart(normalized, {
          period1,
          interval: interval as "1d" | "1wk" | "1mo",
          includePrePost: false,
          events: "div|split"
        }) as Promise<{ quotes?: Array<Record<string, unknown>> }>
      )
    );

    const quotes = (result.quotes ?? []) as Array<{
      date?: string | Date;
      open?: number;
      high?: number;
      low?: number;
      close?: number;
      volume?: number;
    }>;

    return quotes
      .map((candle) => {
        const date = candle.date instanceof Date ? candle.date : candle.date ? new Date(candle.date) : undefined;
        return {
          date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString(),
          open: numberValue(candle.open) ?? 0,
          high: numberValue(candle.high) ?? 0,
          low: numberValue(candle.low) ?? 0,
          close: numberValue(candle.close) ?? 0,
          volume: numberValue(candle.volume)
        };
      })
      .filter((candle) => candle.open && candle.high && candle.low && candle.close);
  }

  async search(query: string): Promise<SearchResult[]> {
    const result = (await retry(this.name, () =>
      withTimeout(() => yahooFinance.search(query, { quotesCount: 10, newsCount: 0 }) as Promise<Record<string, any>>)
    )) ?? {};
    return (result.quotes ?? []).map((quote: YahooQuote) => ({
      symbol: stringValue(quote.symbol) ?? "",
      name: stringValue(quote.shortname) ?? stringValue(quote.longname),
      exchange: exchangeFromYahoo(stringValue(quote.exchange)) ?? normalizeExchange(stringValue(quote.exchDisp)),
      assetType: assetTypeFromYahoo(stringValue(quote.quoteType)),
      type: stringValue(quote.quoteType),
      provider: this.name
    }));
  }

  async screener(scrId: "day_gainers" | "day_losers" | "most_actives" | "trending_tickers", count = 25): Promise<MarketAsset[]> {
    if (scrId === "trending_tickers") {
      try {
        const trending = (await retry(this.name, () =>
          withTimeout(() => yahooFinance.trendingSymbols("US", { count }) as Promise<Record<string, any>>)
        )) ?? {};
        const symbols = (trending.quotes ?? []).map((quote: YahooQuote) => stringValue(quote.symbol)).filter(Boolean) as string[];
        if (symbols.length === 0) return [];
        const quotes = (await retry(this.name, () => withTimeout(() => yahooFinance.quote(symbols) as unknown as Promise<YahooQuote[]>))) ?? [];
        return quotes.map(assetFromQuote);
      } catch {
        return [];
      }
    }

    try {
      const result = (await retry(this.name, () =>
        withTimeout(() =>
          yahooFinance.screener(
            { scrIds: scrId as any, count },
            { validateResult: false }
          ) as Promise<Record<string, any>>
        )
      )) ?? {};
      const quotes = result.quotes ?? result.finance?.result?.[0]?.quotes ?? [];
      return quotes.map(assetFromQuote);
    } catch (error) {
      throw error;
    }
  }

  async indices(): Promise<MarketAsset[]> {
    const symbols = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^FTSE", "^N225", "^HSI"];
    const quotes = (await retry(this.name, () => withTimeout(() => yahooFinance.quote(symbols) as unknown as Promise<YahooQuote[]>))) ?? [];
    return quotes.map(assetFromQuote);
  }

  async compare(symbols: string[]): Promise<MarketAsset[]> {
    if (symbols.length === 0) return [];
    const quotes = (await retry(this.name, () => withTimeout(() => yahooFinance.quote(symbols) as unknown as Promise<YahooQuote[]>))) ?? [];
    return quotes.map(assetFromQuote);
  }

  async news(symbol: string): Promise<NewsItem[]> {
    const result = (await retry(this.name, () =>
      withTimeout(() => yahooFinance.search(symbol, { quotesCount: 0, newsCount: 10 }) as Promise<Record<string, any>>)
    )) ?? {};
    return newsFromItems(result.news);
  }

  async holders(symbol: string, exchange?: string): Promise<{
    majorHolders: Record<string, unknown>;
    institutionalOwnership: Array<Record<string, unknown>>;
    fundOwnership: Array<Record<string, unknown>>;
  }> {
    const normalized = normalizeInstrument(exchange ?? "NASDAQ", symbol).providerSymbols.yahoo ?? normalizeSymbol(symbol, exchange);
    try {
      const summary = (await retry(this.name, () =>
        withTimeout(() =>
          yahooFinance.quoteSummary(normalized, { modules: [...HOLDER_MODULES] }) as Promise<Record<string, any>>
        )
      )) ?? {};
      return {
        majorHolders: summary.majorHoldersBreakdown ?? {},
        institutionalOwnership: summary.institutionOwnership?.ownershipList ?? [],
        fundOwnership: summary.fundOwnership?.ownershipList ?? []
      };
    } catch (error) {
      throw new ProviderError(`Yahoo holders unavailable for ${normalized}`, this.name, error);
    }
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
      events.push({ type: "earnings", date: earningsDate, title: "Earnings date", provider: this.name });
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
