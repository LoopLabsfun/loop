import "server-only";
import { supabaseAdmin } from "./supabase";

// Server-only image upload for pre-launch drafts. Banner + token images land in
// the PUBLIC `waitlist-media` bucket (supabase/schema.sql) via the service role,
// which bypasses storage RLS — so the route stays the only writer. The returned
// public URL is exactly the shape normalizeMediaUrl (lib/waitlist) accepts. The
// 2 MB + image-only checks mirror the bucket limits as defence-in-depth.

const BUCKET = "waitlist-media";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// Allowed image types → file extension. Anything else is rejected.
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type WaitlistMediaKind = "banner" | "token";

/**
 * Upload one pre-launch image and return its public URL, or null on any problem
 * (best-effort — an image must NEVER break the submit; also null pre-migration
 * when the bucket doesn't exist yet). The caller has already verified the wallet
 * signature, so `wallet` is trusted and namespaces the object path.
 */
export async function uploadWaitlistMedia(
  wallet: string,
  kind: WaitlistMediaKind,
  file: File,
): Promise<string | null> {
  const sb = supabaseAdmin;
  if (!sb) return null;
  const ext = MIME_EXT[file.type];
  if (!ext) return null; // not an allowed image type
  if (file.size <= 0 || file.size > MAX_BYTES) return null;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const path = `${wallet}/${kind}-${Date.now()}.${ext}`;
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (error) return null;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl ?? null;
  } catch {
    return null;
  }
}
