import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { uploadProjectMedia } from "@/lib/admin-projects";

// PLATFORM-ADMIN brand-image upload (logo + banner), gated on the LOOP creator_wallet
// — the same super-admin session as the rest of /admin. Multipart (the JSON sibling
// route can't carry a file). Uploads to the public bucket + persists the URL onto the
// project row, then returns it so the editor can preview immediately.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const loop = await getProject("loop");
  if (!loop) return NextResponse.json({ error: "loop project not found" }, { status: 404 });
  if (!isFounder(req, loop)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form-data" }, { status: 400 });
  }
  const key = String(form.get("key") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!/^[a-z0-9-]{1,60}$/.test(key)) {
    return NextResponse.json({ error: "valid project key required" }, { status: 400 });
  }
  if (kind !== "banner" && kind !== "token") {
    return NextResponse.json({ error: "kind must be 'banner' or 'token'" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  try {
    const url = await uploadProjectMedia(key, kind, file);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 400 });
  }
}
