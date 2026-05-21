import { config } from "../config.js";
import type { MarketAsset, ProviderAdapter, SearchResult } from "../types.js";
import { fetchJson } from "../utils/http.js";

export class FinanceApiAdapter implements ProviderAdapter {
  readonly name = "financeapi" as const;
  private readonly baseUrl = "https://api.financeapi.net";

  async search(query: string): Promise<SearchResult[]> {
    if (!config.FINANCEAPI_KEY) return [];

    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("q", query);
    const result = await fetchJson<{ data?: Array<{ symbol: string; name?: string; exchange?: string; type?: string }> }>(
      this.name,
      url,
      { headers: { Authorization: `Bearer ${config.FINANCEAPI_KEY}` } }
    );

    return (result.data ?? []).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      exchange: item.exchange,
      type: item.type,
      provider: this.name
    }));
  }

  async movers(exchange: string): Promise<MarketAsset[]> {
    if (!config.FINANCEAPI_KEY) return [];

    const url = new URL(`${this.baseUrl}/markets/${exchange}/movers`);
    const result = await fetchJson<{ data?: MarketAsset[] }>(this.name, url, {
      headers: { Authorization: `Bearer ${config.FINANCEAPI_KEY}` }
    });

    return result.data ?? [];
  }
}
