import type { MetadataRoute } from "next";
import { docsSource } from "@/lib/docs-source";

const BASE_URL = "https://owlmetry.com";

export default function sitemap(): MetadataRoute.Sitemap {
	const docPages = docsSource.getPages().map((page) => ({
		url: `${BASE_URL}${page.url}`,
		changeFrequency: "weekly" as const,
		priority: page.url === "/docs" ? 0.9 : 0.7,
	}));

	return [
		{
			url: BASE_URL,
			changeFrequency: "weekly",
			priority: 1.0,
		},
		{
			url: `${BASE_URL}/privacy`,
			changeFrequency: "yearly",
			priority: 0.3,
		},
		{
			url: `${BASE_URL}/terms`,
			changeFrequency: "yearly",
			priority: 0.3,
		},
		...docPages,
	];
}
