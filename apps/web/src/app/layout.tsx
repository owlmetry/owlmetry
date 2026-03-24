import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr";
import { TooltipProvider } from "@/components/ui/tooltip";

const dmSans = DM_Sans({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://owlmetry.com"),
  title: {
    default: "OwlMetry — Agent-First Observability for Mobile Apps",
    template: "%s | OwlMetry",
  },
  description:
    "Self-hosted observability for mobile and backend apps. Structured events, performance metrics, and conversion funnels — purpose-built for AI coding agents.",
  openGraph: {
    type: "website",
    siteName: "OwlMetry",
    title: "OwlMetry — Agent-First Observability for Mobile Apps",
    description:
      "Self-hosted observability for mobile and backend apps. Structured events, performance metrics, and conversion funnels.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OwlMetry — Agent-First Observability for Mobile Apps",
    description:
      "Self-hosted observability for mobile and backend apps. Events, metrics, funnels — driven by your coding agent.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
        <SWRProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
