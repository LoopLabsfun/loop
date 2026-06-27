import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSolanaAddress } from "@/lib/api-guards";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { supabaseAdmin } from "@/lib/supabase";
import { limited } from "@/lib/rate-limit";

// Upload a profile avatar. The owner is the signed user-session wallet, and the
// client MUST also state which wallet it's editing (`wallet` form field) — we
// require the two to match. Without that check a stale 7-day session cookie from
// a *previous* wallet would silently write the new image onto the OLD wallet's
// profile (cross-account corruption). A mismatch → 401 so the client re-signs a
// session for the wallet it's actually connected as, then retries. The file is
// validated + stored in the public `avatars` bucket via the service role under a
// wallet-scoped path; image bytes stay server-side.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX = 2 * 1024 * 1024; // 2 MB
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  const wallet = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  if (!wallet) return NextResponse.json({ error: "no session — sign in first" }, { status: 401 });
  const rl = limited("avatar", req, { wallet, limit: 10, windowMs: 60_000 });
  if (rl) return rl;
  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "storage not configured" }, { status: 503 });

  let file: File | null = null;
  let target: string | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const w = form.get("wallet");
    if (typeof w === "string") target = w;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  // The session must belong to the wallet being edited — never a stale one.
  if (!isSolanaAddress(target) || target !== wallet) {
    return NextResponse.json({ error: "session does not match this wallet — re-sign" }, { status: 401 });
  }
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: "use a PNG, JPG, WebP, or GIF" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "image must be under 2 MB" }, { status: 400 });

  const path = `${wallet}/${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const up = await sb.storage.from("avatars").upload(path, bytes, { contentType: file.type, upsert: true });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  const url = data.publicUrl;
  await sb.from("profiles").upsert({ wallet, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "wallet" });
  return NextResponse.json({ ok: true, url });
}
