import type { MetadataRoute } from "next";
import { getProjects } from "@/lib/queries";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const projects = await getProjects().catch(() => []);
  const projectUrls = projects.map((p) => ({
    url: `${SITE_URL}/token?p=${p.key}`,
    changeFrequency: "hourly" as const,
    priority: 0.7,
  }));

  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/docs`, changeFrequency: "weekly", priority: 0.5 },
    ...projectUrls,
  ];
}
