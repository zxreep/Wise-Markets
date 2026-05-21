import Parser from "rss-parser";
import { config } from "../config.js";
import type { NewsItem, ProviderAdapter } from "../types.js";
import { fetchJson } from "../utils/http.js";

export class NewsAdapter implements ProviderAdapter {
  readonly name = "news" as const;
  private readonly parser = new Parser();

  async financeNews(query?: string): Promise<NewsItem[]> {
    if (config.NEWSAPI_KEY) {
      const url = new URL("https://newsapi.org/v2/everything");
      url.searchParams.set("q", query ? `${query} finance` : "markets OR stocks OR finance");
      url.searchParams.set("sortBy", "publishedAt");
      url.searchParams.set("pageSize", "10");
      url.searchParams.set("apiKey", config.NEWSAPI_KEY);
      const result = await fetchJson<{
        articles: Array<{ title: string; url?: string; source?: { name?: string }; publishedAt?: string; description?: string }>;
      }>(this.name, url);
      return result.articles.map((article) => ({
        title: article.title,
        url: article.url,
        publisher: article.source?.name,
        publishedAt: article.publishedAt,
        summary: article.description,
        provider: this.name
      }));
    }

    const feedUrl = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} finance stock market`)}&hl=en-US&gl=US&ceid=US:en`
      : "https://news.google.com/rss/search?q=finance%20stock%20market&hl=en-US&gl=US&ceid=US:en";

    const feed = await this.parser.parseURL(feedUrl);
    return feed.items.slice(0, 10).map((item) => ({
      title: item.title ?? "Untitled",
      url: item.link,
      publisher: item.creator ?? item.source?.title,
      publishedAt: item.isoDate,
      summary: item.contentSnippet,
      provider: this.name
    }));
  }
}
