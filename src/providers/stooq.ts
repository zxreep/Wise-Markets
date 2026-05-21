import type { Candle, MarketAsset, ProviderAdapter } from "../types.js";
import { fetchText, ProviderError } from "../utils/http.js";
import { toStooqSymbol } from "../utils/symbols.js";

export class StooqAdapter implements ProviderAdapter {
  readonly name = "stooq" as const;

  async quote(symbol: string): Promise<MarketAsset> {
    const url = new URL("https://stooq.com/q/l/");
    url.searchParams.set("s", toStooqSymbol(symbol));
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
      exchange: undefined,
      change: undefined,
      changePercent: undefined,
      marketCap: undefined
    };
  }

  async chart(symbol: string, interval = "d"): Promise<Candle[]> {
    const url = new URL("https://stooq.com/q/d/l/");
    url.searchParams.set("s", toStooqSymbol(symbol));
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
