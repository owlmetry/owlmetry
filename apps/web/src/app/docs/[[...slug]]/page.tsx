import { docsSource } from "@/lib/docs-source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import defaultMdxComponents from "fumadocs-ui/mdx";

const BASE = "https://owlmetry.com";

function buildBreadcrumbItems(slugParts: string[], pageTitle: string) {
  const items: { position: number; name: string; item?: string }[] = [
    { position: 1, name: "Docs", item: `${BASE}/docs` },
  ];

  for (let i = 0; i < slugParts.length; i++) {
    const parentSlug = slugParts.slice(0, i + 1);
    const isLast = i === slugParts.length - 1;
    const parentPage = docsSource.getPage(parentSlug);
    const name = isLast ? pageTitle : (parentPage?.data.title ?? slugParts[i]);

    items.push({
      position: i + 2,
      name,
      ...(isLast ? {} : { item: `${BASE}/docs/${parentSlug.join("/")}` }),
    });
  }

  return items;
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = docsSource.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const slugParts = params.slug ?? [];
  const breadcrumbItems = buildBreadcrumbItems(slugParts, page.data.title);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems.map((item) => ({
        "@type": "ListItem",
        ...item,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${page.data.title} — OwlMetry Docs`,
      description: page.data.description,
      url: `${BASE}/docs${slugParts.length ? `/${slugParts.join("/")}` : ""}`,
      publisher: {
        "@type": "Organization",
        name: "Adapted Hub LLC",
        url: BASE,
        logo: `${BASE}/owl-logo.png`,
      },
      isPartOf: { "@type": "WebSite", name: "OwlMetry", url: BASE },
      inLanguage: "en",
    },
  ];

  return (
    <>
      <DocsPage toc={page.data.toc}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={{ ...defaultMdxComponents }} />
        </DocsBody>
      </DocsPage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}

export function generateStaticParams() {
  return docsSource.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = docsSource.getPage(params.slug);
  if (!page) notFound();

  const slug = params.slug?.join("/") ?? "";
  const url = `/docs${slug ? `/${slug}` : ""}`;
  const title = `${page.data.title} — OwlMetry Docs`;
  return {
    title: { absolute: title },
    description: page.data.description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: page.data.description,
      url,
    },
  };
}
