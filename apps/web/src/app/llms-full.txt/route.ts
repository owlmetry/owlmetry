import fs from "node:fs";
import path from "node:path";
import { docsSource } from "@/lib/docs-source";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

export function GET() {
  const pages = docsSource.getPages();
  const docsDir = path.join(process.cwd(), "content/docs");

  const header = [
    "# Owlmetry",
    "",
    "> Self-hosted observability platform for mobile and backend apps. Structured events, performance metrics, and conversion funnels — purpose-built for AI coding agents.",
    "",
    "## About Owlmetry",
    "",
    "Owlmetry is an agent-first, open-source observability platform for mobile and backend apps.",
    "It provides structured events, performance metrics, conversion funnels, and A/B experiments.",
    "",
    "Key capabilities:",
    "- **Events**: Structured events with log levels, session tracking, and screen context",
    "- **Attachments**: Upload files alongside error events for reproducible debugging",
    "- **Metrics**: Time any operation end-to-end — track p50, p95, failure rates",
    "- **Funnels**: Multi-step conversion funnels with A/B experiment segmentation",
    "- **Experiments**: Client-side A/B experiment assignment, persisted across sessions",
    "- **Attribution**: Auto-captured Apple Search Ads acquisition data per user",
    "- **Store reviews & ratings**: App Store ratings (free, no setup) plus individual reviews via App Store Connect integration, filterable by rating/country/version",
    "- **Notifications**: Unified multi-channel inbox (in-app, email, iOS push) with per-user channel preferences",
    "- **SDKs**: Swift (iOS/macOS) and Node.js — batching, compression, and retry built in",
    "- **CLI**: Agent-native CLI for setup, querying, and management (`npm i -g @owlmetry/cli`)",
    "- **Self-hosted**: Single Postgres database, deploy on your own infrastructure",
    "",
    "- Docs: https://owlmetry.com/docs",
    "- GitHub: https://github.com/owlmetry/owlmetry",
    "- Dashboard: https://owlmetry.com/dashboard",
    "",
    "## Pricing",
    "",
    "- **Free**: $0/month — 1 app, 10,000 events/month",
    "- **Pro**: $0/month during alpha (normally $19/mo) — unlimited apps and events",
    "- **Self-Hosted**: $0 forever — unlimited everything on your own infrastructure",
    "",
    "## Alternatives",
    "",
    "Owlmetry is an open-source alternative to Mixpanel, Amplitude, PostHog, and Firebase Analytics,",
    "differentiated by its agent-first API design and single-database self-hosted architecture.",
    "",
    "## Docs",
    "",
  ];

  const pageSections = pages.map((page) => {
    const filePath = path.join(docsDir, page.path);
    let body = "";
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      body = stripFrontmatter(raw);
    } catch {
      body = "(content unavailable)";
    }

    return [
      `# ${page.data.title}`,
      "",
      page.data.description ? `${page.data.description}` : "",
      "",
      `URL: https://owlmetry.com${page.url}`,
      "",
      body,
      "",
      "---",
      "",
    ]
      .join("\n");
  });

  const output = header.join("\n") + "\n---\n\n" + pageSections.join("");

  return new Response(output, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
