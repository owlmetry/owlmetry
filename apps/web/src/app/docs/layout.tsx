import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import { docsSource } from "@/lib/docs-source";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }}>
      <div className="dark bg-background text-foreground min-h-screen" style={{ colorScheme: "dark" }}>
        <DocsLayout
          tree={docsSource.pageTree}
          nav={{
            title: "OwlMetry Docs",
            url: "/docs",
          }}
          themeSwitch={{ enabled: false }}
          links={[
            { text: "Home", url: "/" },
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
      </div>
    </RootProvider>
  );
}
