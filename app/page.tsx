import { Landing } from "@/components/landing/Landing";
import { getProjects } from "@/lib/queries";

// Always fetch fresh so newly launched projects appear without a redeploy.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await getProjects();
  return <Landing projects={projects} />;
}
