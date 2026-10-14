import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/page-meta";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/llms.txt", "/llms-full.txt", "/features.json", "/docs-markdown/"],
        disallow: ["/api/", "/*/admin"],
      },
      {
        userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended"],
        allow: "/",
        disallow: ["/api/", "/*/admin"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
