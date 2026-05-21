import type { Candle, MarketAsset, ProviderAdapter, SearchResult } from "../types.js";
import { fetchJson } from "../utils/http.js";

interface TrendingCoin {
  item: {
    id: string;
    symbol: string;
    name: string;
    market_cap_rank?: number;
    data?: {
      price?: number;
      price_change_percentage_24h?: Record<string, number>;
      market_cap?: string;
      total_volume?: string;
    };
  };
}

interface CoinSearchEntry {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank?: number;
}

export class CoingeckoAdapter implements ProviderAdapter {
  readonly name = "coingecko" as const;
  readonly capabilities = {
    provider: this.name,
    supports: { markets: ["CRYPTO", "BINANCE", "COINBASE", "KRAKEN"], assetTypes: ["crypto"] },
    symbolRules: { input: "BASEQUOTE or coin id", providerFormat: "CoinGecko id/symbol", examples: ["BTCUSDT", "bitcoin"] },
    fallbackMappings: { news: "finance news" }
  } as const;

  private readonly baseUrl = "https://api.coingecko.com/api/v3";
  private readonly minIntervalMs = 2_000;
  private lastCall = 0;

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastCall);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastCall = Date.now();
  }

  async trending(): Promise<MarketAsset[]> {
    await this.throttle();
    const url = new URL(`${this.baseUrl}/search/trending`);
    const result = await fetchJson<{ coins: TrendingCoin[] }>(this.name, url);
    return result.coins.map(({ item }) => ({
      symbol: item.symbol.toUpperCase(),
      name: item.name,
      exchange: "CRYPTO",
      assetType: "crypto",
      price: item.data?.price,
      changePercent: item.data?.price_change_percentage_24h?.usd,
      type: "crypto"
    }));
  }

  async search(query: string): Promise<SearchResult[]> {
    await this.throttle();
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("query", query);
    const result = await fetchJson<{ coins: CoinSearchEntry[] }>(this.name, url);
    return result.coins.slice(0, 10).map((coin) => ({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      id: coin.id,
      exchange: "CRYPTO",
      assetType: "crypto",
      type: "crypto",
      provider: this.name
    }));
  }

  async resolveCoinId(symbol: string): Promise<string | undefined> {
    const cleaned = symbol.toUpperCase();
    const candidates = [cleaned, cleaned.replace(/USDT?$/, ""), cleaned.replace(/USD$/, "")];
    for (const candidate of candidates) {
      const results = await this.search(candidate).catch(() => []);
      const match = results.find((entry) => entry.symbol === candidate) ?? results[0];
      if (match?.id) return match.id;
    }
    return undefined;
  }

  async chart(coinId: string, days: number | "max" = 365): Promise<Candle[]> {
    await this.throttle();
    const url = new URL(`${this.baseUrl}/coins/${encodeURIComponent(coinId)}/market_chart`);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("days", String(days));
    const result = await fetchJson<{ prices?: Array<[number, number]>; total_volumes?: Array<[number, number]> }>(this.name, url);
    const volumes = new Map<number, number>();
    for (const [timestamp, volume] of result.total_volumes ?? []) volumes.set(timestamp, volume);
    return (result.prices ?? []).map(([timestamp, close]) => ({
      date: new Date(timestamp).toISOString(),
      open: close,
      high: close,
      low: close,
      close,
      volume: volumes.get(timestamp)
    }));
  }
}
