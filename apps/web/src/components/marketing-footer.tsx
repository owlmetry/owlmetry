import Link from "next/link";
import { OwlLogo } from "@/components/owl-logo";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Documentation", href: "#" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Swift SDK", href: "#" },
      { label: "Node.js SDK", href: "#" },
      { label: "REST API", href: "#" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "GitHub", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer style={{ background: "oklch(0.12 0.015 55)" }}>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <OwlLogo className="h-7 w-7" />
              <span className="text-lg font-semibold tracking-tight text-white/90">
                OwlMetry
              </span>
            </div>
            <p className="text-sm text-white/40 leading-relaxed">
              Self-hosted analytics that puts you in control of your data.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-white/70 mb-4">
                {col.title}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/40 transition-colors hover:text-white/70"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex items-center justify-between border-t border-white/10 pt-8">
          <p className="text-xs text-white/30">
            &copy; {new Date().getFullYear()} OwlMetry. All rights reserved.
          </p>
          <p className="text-xs text-white/30">Open Source</p>
        </div>
      </div>
    </footer>
  );
}
