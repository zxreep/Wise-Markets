import type { Candle, MarketAsset, ProviderAdapter } from "../types.js";
import { fetchText, ProviderError } from "../utils/http.js";
import { toStooqSymbol } from "../utils/symbols.js";

export class StooqAdapter implements ProviderAdapter {
  readonly name = "stooq" as const;
  readonly capabilities = { provider: this.name, supports: { markets: ["NYSE", "NASDAQ", "AMEX", "NSE", "BSE", "LSE", "XETRA", "TSE", "HKEX", "SSE", "FOREX", "COMMODITIES"], assetTypes: ["equity", "etf", "index", "forex", "commodity"] }, symbolRules: { input: "EXCHANGE:SYMBOL", providerFormat: "Stooq suffix format", examples: ["NASDAQ:AAPL", "NSE:RELIANCE"] }, fallbackMappings: { yahoo: "Yahoo suffix format" } } as const;

  async quote(symbol: string, exchange = "NASDAQ"): Promise<MarketAsset> {
    const url = new URL("https://stooq.com/q/l/");
    url.searchParams.set("s", toStooqSymbol(symbol, exchange));
    url.searchParams.set("f", "sd2t2ohlcvn");
    url.searchParams.set("h", "");
    url.searchParams.set("e", "csv");

    const csv = await fetchText(this.name, url);
    const [, row] = csv.trim().split("\n");
    if (!row) {
      throw new ProviderError(`Stooq returned no quote data for ${symbol}`, this.name);
    }

    const [ticker, date, time, open, high, low, close, volume, name] = row.split(",");
    if (!ticker || close === "N/D" || Number.isNaN(Number(close))) {
      throw new ProviderError(`Stooq returned invalid quote data for ${symbol}`, this.name);
    }

    return {
      symbol: ticker.toUpperCase(),
      name,
      price: Number(close),
      volume: Number(volume),
      type: "equity",
      assetType: "equity",
      exchange,
      change: undefined,
      changePercent: undefined,
      marketCap: undefined
    };
  }

  async chart(symbol: string, interval = "d", exchange = "NASDAQ"): Promise<Candle[]> {
    const url = new URL("https://stooq.com/q/d/l/");
    url.searchParams.set("s", toStooqSymbol(symbol, exchange));
    url.searchParams.set("i", interval);

    const csv = await fetchText(this.name, url);
    const [, ...rows] = csv.trim().split("\n");

    return rows
      .map((row) => row.split(","))
      .filter((columns) => columns.length >= 5)
      .map(([date, open, high, low, close, volume]) => ({
        date: new Date(`${date}T00:00:00Z`).toISOString(),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: volume ? Number(volume) : undefined
      }));
  }
}
