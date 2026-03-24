import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/dashboard/", "/login", "/invite/"],
			},
		],
		sitemap: "https://owlmetry.com/sitemap.xml",
	};
}
