import { config } from "../config.js";
import type { MarketAsset, ProviderAdapter } from "../types.js";
import { fetchText } from "../utils/http.js";

const SERIES: Array<{ id: string; name: string }> = [
  { id: "DGS10", name: "10-Year Treasury Constant Maturity Rate" },
  { id: "DFF", name: "Federal Funds Effective Rate" },
  { id: "CPIAUCSL", name: "Consumer Price Index" },
  { id: "UNRATE", name: "Unemployment Rate" }
];

export class FredAdapter implements ProviderAdapter {
  readonly name = "fred" as const;
  readonly capabilities = {
    provider: this.name,
    supports: { markets: ["FRED"], assetTypes: ["macro", "index"] },
    symbolRules: { input: "FRED:SERIES", providerFormat: "FRED series id", examples: ["FRED:DGS10"] },
    fallbackMappings: {}
  } as const;

  async indices(): Promise<MarketAsset[]> {
    const results = await Promise.all(SERIES.map((series) => this.latest(series).catch(() => undefined)));
    return results.filter((entry): entry is MarketAsset => entry !== undefined);
  }

  private async latest(series: { id: string; name: string }): Promise<MarketAsset | undefined> {
    if (config.FRED_API_KEY) {
      const url = new URL("https://api.stlouisfed.org/fred/series/observations");
      url.searchParams.set("series_id", series.id);
      url.searchParams.set("api_key", config.FRED_API_KEY);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("sort_order", "desc");
      url.searchParams.set("limit", "1");
      const json = await fetchText(this.name, url);
      const parsed = JSON.parse(json) as { observations?: Array<{ value: string }> };
      const value = parsed.observations?.[0]?.value;
      const numeric = value && value !== "." ? Number(value) : undefined;
      return { symbol: series.id, name: series.name, exchange: "FRED", assetType: "macro", price: Number.isFinite(numeric) ? numeric : undefined, type: "macro" };
    }

    // Keyless fallback via public fredgraph CSV endpoint (no API key required).
    const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
    url.searchParams.set("id", series.id);
    const csv = await fetchText(this.name, url);
    const lines = csv.trim().split(/\r?\n/).slice(1).filter((line) => line.includes(","));
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const [, raw] = lines[index].split(",");
      const value = raw?.trim();
      if (value && value !== "." && !Number.isNaN(Number(value))) {
        return { symbol: series.id, name: series.name, exchange: "FRED", assetType: "macro", price: Number(value), type: "macro" };
      }
    }
    return { symbol: series.id, name: series.name, exchange: "FRED", assetType: "macro", price: undefined, type: "macro" };
  }
}
