import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { supabaseAdmin } from "@/lib/supabase";
import { limited } from "@/lib/rate-limit";

// Upload a profile avatar. The owner is taken from the signed user session cookie
// (never the body), the file is validated + stored in the public `avatars` bucket
// via the service role under a wallet-scoped path, and the profile's avatar_url is
// updated. Returns the public URL. Keeps image bytes server-side; the browser only
// ever sends to us, never holds storage credentials.
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
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
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
