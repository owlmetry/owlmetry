"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { OwlLogo } from "@/components/owl-logo";
import { Button } from "@/components/ui/button";
import { useAuthCta } from "@/hooks/use-auth-cta";

const navLinks = [
  { href: "/docs", label: "Docs" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
];

export function MarketingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { href: ctaHref, label: ctaLabel } = useAuthCta();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled
          ? "oklch(0.12 0.015 55 / 0.9)"
          : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        borderBottom: scrolled ? "1px solid oklch(1 0 0 / 0.08)" : "1px solid transparent",
      }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <OwlLogo className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight text-white/90">OwlMetry</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-white/50 transition-colors hover:text-white/90"
            >
              {link.label}
            </a>
          ))}
          <Link href={ctaHref}>
            <Button
              size="sm"
              className="text-white hover:brightness-110 transition-all"
              style={{ background: "oklch(0.555 0.163 48.998)" }}
            >
              {ctaLabel}
            </Button>
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-white/60 hover:text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="border-t border-white/10 px-6 py-4 space-y-3 md:hidden animate-fade-in"
          style={{ background: "oklch(0.12 0.015 55 / 0.95)", backdropFilter: "blur(16px)" }}
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block text-sm text-white/50 hover:text-white/90"
            >
              {link.label}
            </a>
          ))}
          <div className="pt-2">
            <Link href={ctaHref}>
              <Button size="sm" className="w-full text-white" style={{ background: "oklch(0.555 0.163 48.998)" }}>
                {ctaLabel}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
