import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isSolanaAddress } from "@/lib/api-guards";
import { getProfileView, resolveUsername, getProfile } from "@/lib/profile-data";
import { shortAddr } from "@/lib/format";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { ProfileView } from "@/components/profile/ProfileView";

// The [wallet] segment accepts a wallet pubkey OR a @username (without the @).
// A username resolves to its wallet; anything else 404s.
async function resolveParam(param: string): Promise<string | null> {
  if (isSolanaAddress(param)) return param;
  if (/^[a-zA-Z0-9_]{3,20}$/.test(param)) return resolveUsername(param);
  return null;
}

// Public user profile, keyed by wallet pubkey (the Loop identity). force-dynamic:
// positions + the agent log are live on-chain / DB reads, never statically cached.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { wallet: string };
}): Promise<Metadata> {
  const wallet = await resolveParam(params.wallet);
  const profile = wallet ? await getProfile(wallet) : null;
  const name = profile?.displayName || (wallet ? shortAddr(wallet) : "Profile");
  const title = `${name}${profile?.username ? ` (@${profile.username})` : ""} — Loop`;
  const og = wallet ? [{ url: `/profile-og?w=${wallet}`, width: 1200, height: 630 }] : undefined;
  return {
    title,
    description: `${name}'s profile on Loop — the autonomous software factory.`,
    robots: { index: false },
    openGraph: { title, images: og },
    twitter: { card: "summary_large_image", title, images: og },
  };
}

export default async function ProfileRoute({ params }: { params: { wallet: string } }) {
  const wallet = await resolveParam(params.wallet);
  if (!wallet) notFound();
  // The viewer (from their session cookie) lets the server resolve "you follow
  // this wallet" without a client round-trip; absent for signed-out visitors.
  const viewer = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  const data = await getProfileView(wallet, viewer);
  return <ProfileView data={data} />;
}
