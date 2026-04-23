import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import { docsSource } from "@/lib/docs-source";
import { OwlLogo } from "@/components/owl-logo";
import { BookOpen, LayoutDashboard, Github } from "lucide-react";
import type { ReactNode } from "react";

function DocsNavTitle() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <OwlLogo className="h-6 w-6" />
      <span className="text-lg font-semibold tracking-tight">
        OwlMetry
      </span>
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }}>
      <div className="dark bg-background text-foreground min-h-screen" style={{ colorScheme: "dark" }}>
        <DocsLayout
          tree={docsSource.pageTree}
          nav={{
            title: <DocsNavTitle />,
            url: "/",
          }}
          themeSwitch={{ enabled: false }}
          links={[
            { text: "Docs", url: "/docs", icon: <BookOpen /> },
            { text: "Dashboard", url: "/dashboard", icon: <LayoutDashboard /> },
            {
              text: "GitHub",
              url: "https://github.com/owlmetry/owlmetry",
              external: true,
              icon: <Github />,
            },
          ]}
        >
          {children}
        </DocsLayout>
      </div>
    </RootProvider>
  );
}
