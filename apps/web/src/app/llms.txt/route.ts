import { docsSource } from "@/lib/docs-source";

export const dynamic = "force-dynamic";

export function GET() {
  const pages = docsSource.getPages();

  const lines = [
    "# OwlMetry",
    "",
    "> Self-hosted metrics tracking platform for mobile apps. SDKs for Swift and Node.js, CLI for agents, REST API.",
    "",
    "## Docs",
    "",
    ...pages.map(
      (page) =>
        `- [${page.data.title}](${page.url})${page.data.description ? `: ${page.data.description}` : ""}`
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
