import { jsonSchema } from "ai";
import { Agent, fetch as uFetch } from "undici";

// ---------------------------------------------------------------------------
// TLS fingerprint を Chrome に近づけるカスタム Agent
//
// node-libcurl (curl_cffi 相当) はビルドに vcpkg が必要なため、
// ここでは Node.js 組み込みの undici + OpenSSL の cipher suite 順序を
// Chrome 131 に合わせることで JA3 を近似する。
//   - 完全な JA3 spoofing ではないが、デフォルト Node.js よりはるかに近い
//   - TLS 1.3 cipher はブラウザと同一 (AES-128 > AES-256 > CHACHA20)
//   - TLS 1.2 fallback cipher も Chrome 順で並べる
// ---------------------------------------------------------------------------
const CHROME_CIPHERS = [
  // TLS 1.3 (OpenSSL 名)
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  // TLS 1.2 — Chrome が使う順序
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

const chromeTlsAgent = new Agent({
  connect: {
    // TLS 1.2 以上のみ許可 (Chrome と同じ)
    minVersion: "TLSv1.2",
    // Chrome と同じ cipher suite 順序
    ciphers: CHROME_CIPHERS,
    // ALPN: Chrome は h2 → http/1.1 の順
    ALPNProtocols: ["h2", "http/1.1"],
    // ECDH curves: Chrome は X25519 → P-256 → P-384
    ecdhCurve: "X25519:P-256:P-384",
  },
});

// ---------------------------------------------------------------------------
// Rate limiter — sliding window
// Search: 30 req/min (参照実装と同じ上限)
// ---------------------------------------------------------------------------
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private readonly max: number, private readonly windowMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.max) {
      const waitMs = this.windowMs - (now - this.timestamps[0]) + 10;
      await new Promise((r) => setTimeout(r, waitMs));
      return this.acquire();
    }
    this.timestamps.push(now);
  }
}

const searchLimiter = new RateLimiter(30, 60_000);

// ---------------------------------------------------------------------------
// Chrome 131 ブラウザヘッダー一式
// UA だけでなく sec-ch-ua / sec-fetch-* / Accept 系もすべて含む
// ---------------------------------------------------------------------------
const CHROME_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "Cache-Control": "max-age=0",
};

// ---------------------------------------------------------------------------
// Cloudflare / bot challenge 検知
// ---------------------------------------------------------------------------
function isCloudflareChallenge(html: string, status: number): boolean {
  if (status === 429 || status === 503) return true;
  return (
    html.includes("cf-browser-verification") ||
    html.includes("cf_clearance") ||
    (html.includes("Cloudflare") && html.includes("challenge"))
  );
}

// ---------------------------------------------------------------------------
// fetch wrapper:
//   primary   → Chrome TLS Agent + Chrome headers
//   fallback  → 403/503 時に Referer 付きで retry (1〜2.5 秒 jitter)
// ---------------------------------------------------------------------------
async function chromeFetch(
  url: string,
  init: Parameters<typeof uFetch>[1] & { headers?: Record<string, string> },
): ReturnType<typeof uFetch> {
  const res = await uFetch(url, { ...init, dispatcher: chromeTlsAgent });

  if (res.status === 403 || res.status === 429 || res.status === 503) {
    const body = await res.clone().text();
    if (isCloudflareChallenge(body, res.status)) {
      console.warn("[google:search] bot block detected (status=%d), retrying...", res.status);
    }
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
    return uFetch(url, {
      ...init,
      dispatcher: chromeTlsAgent,
      headers: {
        ...(init.headers ?? {}),
        "sec-fetch-site": "same-origin",
        Referer: "https://lite.duckduckgo.com/",
      },
    });
  }

  return res;
}

// ---------------------------------------------------------------------------
// HTML パース
// ---------------------------------------------------------------------------
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function fetchWebResults(query: string): Promise<SearchResult[]> {
  await searchLimiter.acquire();

  const res = await chromeFetch("https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: {
      ...CHROME_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "same-origin",
      Referer: "https://lite.duckduckgo.com/",
    },
    body: `q=${encodeURIComponent(query)}`,
  });

  if (!res.ok) return [];

  const html = await res.text();
  if (isCloudflareChallenge(html, res.status)) {
    console.warn("[google:search] challenge page in response body");
    return [];
  }

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

  return links.slice(0, 5).map((l, i) => ({ ...l, snippet: snippets[i] ?? "" }));
}

async function search(query: string): Promise<string> {
  const results = await fetchWebResults(query);
  if (results.length === 0) return "No results found.";
  return results.map((r) => `${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------
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
