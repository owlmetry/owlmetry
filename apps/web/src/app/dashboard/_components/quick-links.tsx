"use client";

import Link from "next/link";
import { ArrowUpRight, Rocket, Smartphone, Server, Terminal, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface DocLink {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const LINKS: DocLink[] = [
  {
    label: "Getting Started",
    description: "Your first project",
    href: "/docs/getting-started",
    icon: Rocket,
  },
  {
    label: "Swift SDK",
    description: "iOS, iPadOS, macOS",
    href: "/docs/sdks/swift",
    icon: Smartphone,
  },
  {
    label: "Node SDK",
    description: "Backend instrumentation",
    href: "/docs/sdks/node",
    icon: Server,
  },
  {
    label: "CLI",
    description: "Query from terminal",
    href: "/docs/cli",
    icon: Terminal,
  },
  {
    label: "MCP",
    description: "Connect AI agents",
    href: "/docs/mcp/setup",
    icon: Plug,
  },
];

export function QuickLinks() {
  return (
    <div className="rounded-md border bg-card shadow-sm overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2.5 border-b">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Docs
          </span>
          <h3 className="text-sm font-semibold tracking-tight">Documentation</h3>
        </div>
      </div>
      <div className="grid divide-y divide-border/60 md:grid-cols-5 md:divide-y-0 md:divide-x">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
              <link.icon className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{link.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {link.description}
              </p>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-all group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
