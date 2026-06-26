import { cookies } from "next/headers";
import Link from "next/link";
import { verifyAdminToken, ADMIN_COOKIE } from "@/lib/admin-session";
import { getProject } from "@/lib/queries";
import { TokenPageView } from "@/components/token/TokenPageView";

// FOUNDER-ONLY preview of "Loop v2" — the redesigned token page (merged hero)
// rendered with the SAME live data as the public page, but hidden behind the admin
// session. Lets the founder evaluate v2 on the real site before it ever ships to
// the public /token. Gate = the admin session cookie bound to creator_wallet
// (same proof flow as /admin); no session ⇒ a sign-in prompt, never the page.
export const dynamic = "force-dynamic";

export default async function AdminV2Page() {
  const token = cookies().get(ADMIN_COOKIE)?.value ?? null;
  const wallet = verifyAdminToken(token)?.wallet ?? null;
  const project = await getProject("loop");
  const isFounder = Boolean(
    wallet && project?.creatorWallet && wallet === project.creatorWallet
  );

  if (!isFounder) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-8 text-center max-w-[440px]">
          <div className="font-display font-semibold text-[16px] mb-1">Loop v2 · founder preview</div>
          <p className="text-[13px] text-muted mb-5">
            This hidden preview is founder-only. Sign in with the project's creator wallet on
            the admin console first, then come back.
          </p>
          <Link
            href="/admin"
            className="font-display font-semibold text-[14px] px-5 h-[40px] inline-flex items-center justify-center rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity"
          >
            Go to admin sign-in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="bg-accent text-white text-center text-[12px] font-mono py-[6px] px-3">
        Loop v2 · founder preview — not public ·{" "}
        <Link href="/admin" className="underline underline-offset-2">
          back to admin
        </Link>
      </div>
      <TokenPageView projectKey="loop" hero="merged" />
    </>
  );
}
