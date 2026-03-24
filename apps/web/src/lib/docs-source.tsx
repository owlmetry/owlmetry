import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";
import {
  Rocket,
  Lightbulb,
  Code,
  Terminal,
  FileCode,
  Server,
  CircleHelp,
} from "lucide-react";
import type { ReactNode } from "react";

const icons: Record<string, ReactNode> = {
  Rocket: <Rocket className="h-4 w-4" />,
  Lightbulb: <Lightbulb className="h-4 w-4" />,
  Code: <Code className="h-4 w-4" />,
  Terminal: <Terminal className="h-4 w-4" />,
  FileCode: <FileCode className="h-4 w-4" />,
  Server: <Server className="h-4 w-4" />,
  CircleHelp: <CircleHelp className="h-4 w-4" />,
};

export const docsSource = loader({
  baseUrl: "/docs",
  source: createMDXSource(docs.docs, docs.meta),
  icon: (name) => (name ? icons[name] : undefined),
});
