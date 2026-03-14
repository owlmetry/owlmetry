import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OwlMetry",
  description: "Self-hosted metrics tracking for mobile apps",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SWRProvider>{children}</SWRProvider>
      </body>
    </html>
  );
}
