import type { MarketAsset, ProviderAdapter, SearchResult } from "../types.js";
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

export class CoingeckoAdapter implements ProviderAdapter {
  readonly name = "coingecko" as const;
  private readonly baseUrl = "https://api.coingecko.com/api/v3";

  async trending(): Promise<MarketAsset[]> {
    const url = new URL(`${this.baseUrl}/search/trending`);
    const result = await fetchJson<{ coins: TrendingCoin[] }>(this.name, url);

    return result.coins.map(({ item }) => ({
      symbol: item.symbol.toUpperCase(),
      name: item.name,
      exchange: "CRYPTO",
      price: item.data?.price,
      changePercent: item.data?.price_change_percentage_24h?.usd,
      type: "crypto"
    }));
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("query", query);
    const result = await fetchJson<{ coins: Array<{ id: string; name: string; symbol: string; market_cap_rank?: number }> }>(
      this.name,
      url
    );

    return result.coins.slice(0, 10).map((coin) => ({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      exchange: "CRYPTO",
      type: "crypto",
      provider: this.name
    }));
  }
}
