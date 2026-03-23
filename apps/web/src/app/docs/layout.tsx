import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import { docsSource } from "@/lib/docs-source";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={docsSource.pageTree}
        nav={{
          title: "OwlMetry",
          url: "/",
        }}
        links={[
          { text: "Dashboard", url: "/dashboard" },
          {
            text: "GitHub",
            url: "https://github.com/Jasonvdb/owlmetry",
            external: true,
          },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
