import { docsSource } from "@/lib/docs-source";

export function GET() {
  const pages = docsSource.getPages();

  const lines = [
    "# OwlMetry",
    "",
    "> Self-hosted observability platform for mobile and backend apps. Structured events, performance metrics, and conversion funnels — purpose-built for AI coding agents.",
    "",
    "## Docs",
    "",
    ...pages.map(
      (page) =>
        `- [${page.data.title}](https://owlmetry.com${page.url})${page.data.description ? `: ${page.data.description}` : ""}`
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
