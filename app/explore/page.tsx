import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getProjects } from "@/lib/queries";
import { getRecentProfiles } from "@/lib/social";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { ExploreView } from "@/components/ExploreView";

// Explore — browse projects and people on Loop. Discovery, not a ranking.
// force-dynamic: live project + profile reads.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore — Loop" };

export default async function ExplorePage() {
  const viewer = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  const [projects, people] = await Promise.all([getProjects(), getRecentProfiles(viewer)]);
  return <ExploreView projects={projects} people={people} />;
}
