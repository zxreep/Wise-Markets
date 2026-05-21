import type { AssetType, ExchangeDefinition, NormalizedSymbol, ProviderName } from "../types.js";

const exchangeDefinitions: ExchangeDefinition[] = [
  { code: "NASDAQ", name: "Nasdaq Stock Market", country: "US", region: "americas", market: "securities", assetTypes: ["equity", "etf", "index", "mutual_fund"], aliases: ["NAS", "US"], providerSymbols: { yahoo: {}, stooq: { suffix: ".US" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "NYSE", name: "New York Stock Exchange", country: "US", region: "americas", market: "securities", assetTypes: ["equity", "etf", "index", "mutual_fund"], aliases: ["US"], providerSymbols: { yahoo: {}, stooq: { suffix: ".US" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "AMEX", name: "NYSE American", country: "US", region: "americas", market: "securities", assetTypes: ["equity", "etf"], aliases: ["NYSEAMERICAN"], providerSymbols: { yahoo: {}, stooq: { suffix: ".US" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "NSE", name: "National Stock Exchange of India", country: "IN", region: "asia", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["NSEINDIA"], providerSymbols: { yahoo: { suffix: ".NS" }, stooq: { suffix: ".IN" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "BSE", name: "Bombay Stock Exchange", country: "IN", region: "asia", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: [], providerSymbols: { yahoo: { suffix: ".BO" }, stooq: { suffix: ".IN" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "LSE", name: "London Stock Exchange", country: "GB", region: "europe", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["LON"], providerSymbols: { yahoo: { suffix: ".L" }, stooq: { suffix: ".UK" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "EURONEXT", name: "Euronext", region: "europe", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["EPA", "AMS", "PAR"], providerSymbols: { yahoo: { suffix: ".PA" }, stooq: { suffix: ".FR" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "XETRA", name: "Xetra", country: "DE", region: "europe", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["ETR", "FRA"], providerSymbols: { yahoo: { suffix: ".DE" }, stooq: { suffix: ".DE" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "TSE", name: "Tokyo Stock Exchange", country: "JP", region: "asia", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["JPX", "TYO"], providerSymbols: { yahoo: { suffix: ".T" }, stooq: { suffix: ".JP" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "HKEX", name: "Hong Kong Stock Exchange", country: "HK", region: "asia", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["HKG"], providerSymbols: { yahoo: { suffix: ".HK" }, stooq: { suffix: ".HK" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "SSE", name: "Shanghai Stock Exchange", country: "CN", region: "asia", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: ["SHA"], providerSymbols: { yahoo: { suffix: ".SS" }, stooq: { suffix: ".CN" } }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "BINANCE", name: "Binance", region: "global", market: "crypto", assetTypes: ["crypto"], aliases: ["BN"], providerSymbols: { coingecko: {}, ccxt: {} }, defaultProviders: ["coingecko", "news"] },
  { code: "COINBASE", name: "Coinbase Exchange", region: "global", market: "crypto", assetTypes: ["crypto"], aliases: ["COINBASEPRO"], providerSymbols: { coingecko: {}, ccxt: {} }, defaultProviders: ["coingecko", "news"] },
  { code: "KRAKEN", name: "Kraken", region: "global", market: "crypto", assetTypes: ["crypto"], aliases: [], providerSymbols: { coingecko: {}, ccxt: {} }, defaultProviders: ["coingecko", "news"] },
  { code: "CRYPTO", name: "Crypto Aggregate", region: "global", market: "crypto", assetTypes: ["crypto"], aliases: ["COINGECKO"], providerSymbols: { coingecko: {}, ccxt: {} }, defaultProviders: ["coingecko", "news"] },
  { code: "FOREX", name: "Foreign Exchange", region: "global", market: "forex", assetTypes: ["forex"], aliases: ["FX"], providerSymbols: { yahoo: { suffix: "=X" }, stooq: {} }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "COMMODITIES", name: "Commodities", region: "global", market: "securities", assetTypes: ["commodity"], aliases: ["COMMODITY"], providerSymbols: { yahoo: {}, stooq: {} }, defaultProviders: ["yahoo", "stooq", "news"] },
  { code: "FRED", name: "Federal Reserve Economic Data", country: "US", region: "americas", market: "macro", assetTypes: ["macro", "index"], aliases: ["MACRO"], providerSymbols: { fred: {} }, defaultProviders: ["fred"] }
];

const exchangeMap = new Map<string, ExchangeDefinition>();
for (const exchange of exchangeDefinitions) {
  exchangeMap.set(exchange.code, exchange);
  for (const alias of exchange.aliases) exchangeMap.set(alias.toUpperCase(), exchange);
}

const yahooExchangeAliases: Record<string, string> = { NMS: "NASDAQ", NCM: "NASDAQ", NGM: "NASDAQ", NYQ: "NYSE", ASE: "AMEX", NSI: "NSE", BSE: "BSE", LSE: "LSE", GER: "XETRA", JPX: "TSE", HKG: "HKEX", SHH: "SSE", CCC: "CRYPTO", CCY: "FOREX" };
const yahooTypeMap: Record<string, AssetType> = { EQUITY: "equity", ETF: "etf", INDEX: "index", MUTUALFUND: "mutual_fund", CURRENCY: "forex", CRYPTOCURRENCY: "crypto", FUTURE: "commodity" };

export function listExchanges(): ExchangeDefinition[] { return exchangeDefinitions; }

export function getExchange(exchange: string): ExchangeDefinition {
  const normalized = exchange.trim().toUpperCase();
  return exchangeMap.get(normalized) ?? { code: normalized, name: normalized, region: "global", market: "securities", assetTypes: ["equity", "etf", "index"], aliases: [], providerSymbols: { yahoo: {}, stooq: {} }, defaultProviders: ["yahoo", "stooq", "news"] };
}

export function normalizeExchange(exchange?: string): string | undefined { return exchange ? getExchange(exchange).code : undefined; }

export function inferAssetType(symbol: string, exchange: ExchangeDefinition, explicit?: string): AssetType {
  if (explicit && exchange.assetTypes.includes(explicit as AssetType)) return explicit as AssetType;
  if (exchange.market === "crypto") return "crypto";
  if (exchange.market === "forex") return "forex";
  if (exchange.market === "macro") return "macro";
  if (symbol.startsWith("^")) return "index";
  if (symbol.includes("=")) return "forex";
  return exchange.assetTypes[0] ?? "equity";
}

export function providerSymbol(symbol: string, exchange: ExchangeDefinition, provider: ProviderName, assetType?: AssetType): string {
  const cleaned = symbol.trim().replace(/\s+/g, "").toUpperCase();
  const rule = exchange.providerSymbols[provider];
  if (provider === "yahoo" && assetType === "forex") return cleaned.endsWith("=X") ? cleaned : `${cleaned}=X`;
  if (provider === "stooq" && ["NASDAQ", "NYSE", "AMEX"].includes(exchange.code) && !cleaned.includes(".") && !cleaned.startsWith("^")) return `${cleaned}.US`.toLowerCase();
  if (!rule) return cleaned;
  if (rule.prefix && !cleaned.startsWith(rule.prefix)) return `${rule.prefix}${cleaned}`;
  if (rule.suffix && !cleaned.endsWith(rule.suffix)) return `${cleaned}${rule.suffix}`;
  return cleaned;
}

export function normalizeSymbol(symbol: string, exchange = "NASDAQ", assetType?: string): string {
  return normalizeInstrument(exchange, symbol, assetType).providerSymbols.yahoo ?? symbol.trim().toUpperCase();
}

export function normalizeInstrument(exchange: string, symbol: string, assetType?: string): NormalizedSymbol {
  const definition = getExchange(exchange);
  const cleaned = symbol.trim().replace(/\s+/g, "").toUpperCase();
  const resolvedAssetType = inferAssetType(cleaned, definition, assetType);
  const providerSymbols = Object.fromEntries(definition.defaultProviders.map((provider) => [provider, providerSymbol(cleaned, definition, provider, resolvedAssetType)])) as Partial<Record<ProviderName, string>>;
  return { exchange: definition.code, symbol: cleaned, assetType: resolvedAssetType, providerSymbols, canonical: `${definition.code}:${cleaned}` };
}

export function splitSymbols(symbols: string, exchange = "NASDAQ"): string[] {
  return symbols.split(",").map((symbol) => normalizeInstrument(exchange, symbol).providerSymbols.yahoo ?? symbol.trim().toUpperCase()).filter(Boolean);
}

export function toStooqSymbol(symbol: string, exchange = "NASDAQ"): string {
  const definition = getExchange(exchange);
  return providerSymbol(symbol, definition, "stooq", inferAssetType(symbol, definition)).toLowerCase();
}

export function exchangeFromYahoo(exchange?: string): string | undefined { return exchange ? yahooExchangeAliases[exchange.toUpperCase()] ?? normalizeExchange(exchange) : undefined; }
export function assetTypeFromYahoo(type?: string): AssetType | undefined { return type ? yahooTypeMap[type.toUpperCase()] : undefined; }
