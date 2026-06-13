import type { MetadataRoute } from "next";
import { getProjects } from "@/lib/queries";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const projects = await getProjects().catch(() => []);
  const projectUrls = projects.map((p) => ({
    url: `${siteUrl}/token?p=${p.key}`,
    changeFrequency: "hourly" as const,
    priority: 0.7,
  }));

  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/docs`, changeFrequency: "weekly", priority: 0.5 },
    ...projectUrls,
  ];
}
