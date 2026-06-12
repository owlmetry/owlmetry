import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Ratings & Reviews",
};

export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
