export type ProviderName = "yahoo" | "financeapi" | "coingecko" | "fred" | "stooq" | "news";

export interface ApiEnvelope<T> {
  data: T;
  meta: {
    provider: ProviderName | "aggregate";
    fallbackProviders?: ProviderName[];
    symbol?: string;
    exchange?: string;
    asOf: string;
    cached?: boolean;
  };
}

export interface PriceSnapshot {
  regularMarketPrice?: number;
  previousClose?: number;
  currency?: string;
  marketState?: string;
  exchange?: string;
  sourceTime?: string;
}

export interface Fundamentals {
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  returnOnEquity?: number;
  returnOnCapitalEmployed?: number;
  dividendYield?: number;
  beta?: number;
}

export interface CompanyProfile {
  name?: string;
  sector?: string;
  industry?: string;
  website?: string;
  country?: string;
  employees?: number;
  summary?: string;
}

export interface FinancialStatementRow {
  period?: string;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  cash?: number;
  operatingCashflow?: number;
  freeCashflow?: number;
}

export interface SecurityOverview {
  symbol: string;
  exchange?: string;
  price: PriceSnapshot;
  fundamentals: Fundamentals;
  financials: {
    annual: FinancialStatementRow[];
    quarterly: FinancialStatementRow[];
    cashflow: FinancialStatementRow[];
  };
  profile: CompanyProfile;
  historicalPerformance: Record<string, number | undefined>;
  events: MarketEvent[];
  news: NewsItem[];
}

export interface MarketAsset {
  symbol: string;
  name?: string;
  exchange?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  marketCap?: number;
  type?: string;
}

export interface MarketEvent {
  type: "earnings" | "dividend" | "split" | "filing" | "news";
  date?: string;
  title: string;
  url?: string;
  value?: number | string;
  provider: ProviderName;
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SearchResult {
  symbol: string;
  name?: string;
  exchange?: string;
  type?: string;
  provider: ProviderName;
}

export interface NewsItem {
  title: string;
  url?: string;
  publisher?: string;
  publishedAt?: string;
  summary?: string;
  provider: ProviderName;
}

export interface ForexRate {
  pair: string;
  rate: number;
  asOf?: string;
  provider: ProviderName;
}

export interface ProviderAdapter {
  name: ProviderName;
}
