import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isSolanaAddress } from "@/lib/api-guards";
import { getProfileView } from "@/lib/profile-data";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { ProfileView } from "@/components/profile/ProfileView";

// Public user profile, keyed by wallet pubkey (the Loop identity). force-dynamic:
// positions + the agent log are live on-chain / DB reads, never statically cached.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { wallet: string };
}): Promise<Metadata> {
  const w = params.wallet;
  const short = w && w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : "Profile";
  return { title: `${short} — Loop`, robots: { index: false } };
}

export default async function ProfileRoute({ params }: { params: { wallet: string } }) {
  if (!isSolanaAddress(params.wallet)) notFound();
  // The viewer (from their session cookie) lets the server resolve "you follow
  // this wallet" without a client round-trip; absent for signed-out visitors.
  const viewer = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  const data = await getProfileView(params.wallet, viewer);
  return <ProfileView data={data} />;
}
