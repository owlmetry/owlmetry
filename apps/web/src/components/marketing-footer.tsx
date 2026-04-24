import Link from "next/link";
import { OwlLogo } from "@/components/owl-logo";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Get Started", href: "#get-started" },
      { label: "About", href: "/about" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Swift SDK", href: "/docs/sdks/swift" },
      { label: "Node.js SDK", href: "/docs/sdks/node" },
      { label: "CLI", href: "/docs/cli" },
      { label: "API Reference", href: "/docs/api-reference" },
      { label: "GitHub", href: "https://github.com/owlmetry/owlmetry" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
  {
    title: "Contact",
    links: [
      { label: "jason@owlmetry.com", href: "mailto:jason@owlmetry.com" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer style={{ background: "oklch(0.10 0.012 55)" }}>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-5">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <OwlLogo className="h-7 w-7" />
              <span className="text-lg font-semibold tracking-tight text-white/90">
                Owlmetry
              </span>
            </div>
            <p className="text-sm text-white/35 leading-relaxed">
              Agent-first observability. Self-hosted by design.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/50 mb-4">
                {col.title}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/35 transition-colors hover:text-white/70"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex items-center justify-between border-t border-white/[0.06] pt-8">
          <p className="text-xs text-white/25">
            &copy; {new Date().getFullYear()} Owlmetry
          </p>
          <p className="text-xs text-white/25">Open Source</p>
        </div>
      </div>
    </footer>
  );
}
