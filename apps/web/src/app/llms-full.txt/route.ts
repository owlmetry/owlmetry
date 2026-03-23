import fs from "node:fs";
import path from "node:path";
import { docsSource } from "@/lib/docs-source";

export const dynamic = "force-dynamic";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

export function GET() {
  const pages = docsSource.getPages();
  const docsDir = path.join(process.cwd(), "content/docs");

  const header = [
    "# OwlMetry",
    "",
    "> Self-hosted metrics tracking platform for mobile apps. SDKs for Swift and Node.js, CLI for agents, REST API.",
    "",
    "## About OwlMetry",
    "",
    "OwlMetry is an agent-first, open-source observability platform for mobile and backend apps.",
    "It provides structured events, performance metrics, conversion funnels, and A/B experiments.",
    "",
    "Key capabilities:",
    "- **Events**: Structured events with log levels, session tracking, and screen context",
    "- **Metrics**: Time any operation end-to-end — track p50, p95, failure rates",
    "- **Funnels**: Multi-step conversion funnels with A/B experiment segmentation",
    "- **Experiments**: Client-side A/B experiment assignment, persisted across sessions",
    "- **SDKs**: Swift (iOS/macOS) and Node.js — batching, compression, and retry built in",
    "- **CLI**: Agent-native CLI for setup, querying, and management (`npm i -g @owlmetry/cli`)",
    "- **Self-hosted**: Single Postgres database, deploy on your own infrastructure",
    "",
    "- Docs: https://owlmetry.com/docs",
    "- GitHub: https://github.com/Jasonvdb/owlmetry",
    "- Dashboard: https://owlmetry.com/dashboard",
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
