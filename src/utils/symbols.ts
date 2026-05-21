const exchangeAliases: Record<string, string> = {
  nasdaq: "NASDAQ",
  nyse: "NYSE",
  amex: "AMEX",
  us: "US",
  nse: "NSE",
  bse: "BSE",
  lse: "LSE",
  crypto: "CRYPTO",
  forex: "FOREX"
};

const yahooSuffixByExchange: Record<string, string> = {
  NSE: ".NS",
  BSE: ".BO",
  LSE: ".L"
};

export function normalizeExchange(exchange?: string): string | undefined {
  if (!exchange) return undefined;
  return exchangeAliases[exchange.toLowerCase()] ?? exchange.toUpperCase();
}

export function normalizeSymbol(symbol: string, exchange?: string): string {
  const cleaned = symbol.trim().replace(/\s+/g, "").toUpperCase();
  const normalizedExchange = normalizeExchange(exchange);
  const suffix = normalizedExchange ? yahooSuffixByExchange[normalizedExchange] : undefined;

  if (!suffix || cleaned.endsWith(suffix)) {
    return cleaned;
  }

  return `${cleaned}${suffix}`;
}

export function splitSymbols(symbols: string): string[] {
  return symbols
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);
}

export function toStooqSymbol(symbol: string): string {
  return symbol.replace(".NS", ".IN").replace(".BO", ".IN").toLowerCase();
}
