import { jsonSchema } from "ai";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function fetchWebResults(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
      "Accept": "text/html",
      "Accept-Language": "ja,en;q=0.9",
    },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!res.ok) return [];

  const html = await res.text();

  // href が class より先: <a rel="nofollow" href="..." class='result-link'>Title</a>
  const linkRe = /<a[^>]+href=['"]([^'"]+)['"]\s+class=['"]result-link['"]>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;

  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, "").trim() });
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
  }

  return links.slice(0, 5).map((l, i) => ({
    ...l,
    snippet: snippets[i] ?? "",
  }));
}

async function search(query: string): Promise<string> {
  const results = await fetchWebResults(query);
  if (results.length === 0) return "No results found.";
  return results.map((r) => `${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}

export const googleSearchTool = {
  description: "Search the web for current information",
  parameters: jsonSchema<{ query: string }>({
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  execute: async (args: unknown): Promise<string> => {
    console.log("[google:search] raw args:", JSON.stringify(args));
    const { query } = (args ?? {}) as { query?: string };
    console.log("[google:search] query:", query);
    if (!query) return "No query provided.";
    try {
      const result = await search(query);
      console.log("[google:search] result:", result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[google:search] error:", msg);
      return `Search failed: ${msg}`;
    }
  },
};
