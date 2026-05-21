import { config } from "../config.js";
import type { MarketAsset, ProviderAdapter } from "../types.js";
import { fetchJson } from "../utils/http.js";

export class FredAdapter implements ProviderAdapter {
  readonly name = "fred" as const;

  async indices(): Promise<MarketAsset[]> {
    if (!config.FRED_API_KEY) {
      return [];
    }

    const series = [
      ["DGS10", "10-Year Treasury Constant Maturity Rate"],
      ["DFF", "Federal Funds Effective Rate"],
      ["CPIAUCSL", "Consumer Price Index"],
      ["UNRATE", "Unemployment Rate"]
    ] as const;

    const values = await Promise.all(
      series.map(async ([id, name]) => {
        const url = new URL("https://api.stlouisfed.org/fred/series/observations");
        url.searchParams.set("series_id", id);
        url.searchParams.set("api_key", config.FRED_API_KEY!);
        url.searchParams.set("file_type", "json");
        url.searchParams.set("sort_order", "desc");
        url.searchParams.set("limit", "1");
        const result = await fetchJson<{ observations: Array<{ date: string; value: string }> }>(this.name, url);
        const latest = result.observations[0];
        return {
          symbol: id,
          name,
          exchange: "FRED",
          price: latest?.value === "." ? undefined : Number(latest?.value),
          type: "macro"
        };
      })
    );

    return values;
  }
}
