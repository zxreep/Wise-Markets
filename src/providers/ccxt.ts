import ccxt from "ccxt";
import type { MarketAsset, ProviderAdapter } from "../types.js";
import { retry, withTimeout } from "../utils/http.js";

const exchangeIds: Record<string, string> = {
  BINANCE: "binance",
  COINBASE: "coinbase",
  KRAKEN: "kraken"
};

function ccxtSymbol(symbol: string): string {
  const cleaned = symbol.toUpperCase().replace(/[-_/]/g, "");
  const quotes = ["USDT", "USD", "EUR", "BTC", "ETH"];
  const quote = quotes.find((candidate) => cleaned.endsWith(candidate) && cleaned.length > candidate.length);
  return quote ? `${cleaned.slice(0, -quote.length)}/${quote}` : cleaned;
}

export class CcxtAdapter implements ProviderAdapter {
  readonly name = "ccxt" as const;
  readonly capabilities = {
    provider: this.name,
    supports: { markets: ["BINANCE", "COINBASE", "KRAKEN"], assetTypes: ["crypto"] },
    symbolRules: { input: "EXCHANGE:BASEQUOTE", providerFormat: "CCXT pair format", examples: ["BINANCE:BTCUSDT", "KRAKEN:ETHUSD"] },
    fallbackMappings: { coingecko: "CoinGecko metadata/trending" }
  } as const;

  async ticker(exchange: string, symbol: string): Promise<MarketAsset | undefined> {
    const id = exchangeIds[exchange.toUpperCase()];
    if (!id) return undefined;

    const Exchange = ccxt[id as keyof typeof ccxt] as unknown as new () => { fetchTicker: (symbol: string) => Promise<Record<string, number | undefined>> };
    const client = new Exchange();
    const ticker = await retry(this.name, () => withTimeout(() => client.fetchTicker(ccxtSymbol(symbol))));

    return {
      symbol: symbol.toUpperCase(),
      exchange: exchange.toUpperCase(),
      assetType: "crypto",
      price: ticker.last ?? ticker.close ?? undefined,
      change: ticker.change ?? undefined,
      changePercent: ticker.percentage ?? undefined,
      volume: ticker.baseVolume ?? undefined,
      type: "crypto"
    };
  }
}
