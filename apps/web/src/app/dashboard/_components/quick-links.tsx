"use client";

import Link from "next/link";
import { Rocket, Smartphone, Server, Terminal, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface DocLink {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const LINKS: DocLink[] = [
  {
    label: "Getting Started",
    description: "Set up your first project",
    href: "/docs/getting-started",
    icon: Rocket,
  },
  {
    label: "Swift SDK",
    description: "Instrument iOS, iPadOS, macOS",
    href: "/docs/sdks/swift",
    icon: Smartphone,
  },
  {
    label: "Node SDK",
    description: "Instrument your backend",
    href: "/docs/sdks/node",
    icon: Server,
  },
  {
    label: "CLI",
    description: "Query from your terminal",
    href: "/docs/cli",
    icon: Terminal,
  },
  {
    label: "MCP Setup",
    description: "Connect your AI coding agent",
    href: "/docs/mcp/setup",
    icon: Plug,
  },
];

export function QuickLinks() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href}>
          <Card className="group h-full rounded-md p-4 transition-colors hover:border-primary/40">
            <link.icon className="h-5 w-5 text-primary mb-2" />
            <p className="text-sm font-medium">{link.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {link.description}
            </p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
