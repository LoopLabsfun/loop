import "server-only";
import crypto from "crypto";
import { supabaseAdmin } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// PER-PROJECT SECRETS — the multi-tenant compute key.
//
// Each project can run its agent on its OWN Anthropic key (BYO), billed to its
// founder, not Loop. Keys are encrypted at rest (AES-256-GCM) and decrypted ONLY
// server-side. Gated on PROJECT_SECRETS_KEY (a 32-byte master key, hex or base64):
// when it's unset the store is OFF and every read falls back to the global key —
// so LOOP / the default path is byte-identical until the founder arms it.
// ─────────────────────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";

function masterKey(): Buffer | null {
  const raw = (process.env.PROJECT_SECRETS_KEY || "").trim();
  if (!raw) return null;
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else {
    try {
      buf = Buffer.from(raw, "base64");
    } catch {
      return null;
    }
  }
  return buf.length === 32 ? buf : null;
}

/** True when a valid 32-byte PROJECT_SECRETS_KEY is set (the store is armed). */
export function secretsConfigured(): boolean {
  return masterKey() !== null;
}

/** Encrypt plaintext → base64(iv|tag|ciphertext). Throws if unconfigured. */
export function encryptSecret(plain: string): string {
  const key = masterKey();
  if (!key) throw new Error("PROJECT_SECRETS_KEY not set (or not 32 bytes).");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt base64(iv|tag|ciphertext) → plaintext, or null on any failure (bad key,
 *  tamper, unconfigured). */
export function decryptSecret(blob: string): string | null {
  const key = masterKey();
  if (!key) return null;
  try {
    const raw = Buffer.from(blob, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Store a project's BYO Anthropic key (encrypted). */
export async function setProjectAnthropicKey(projectKey: string, plain: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");
  if (!secretsConfigured()) throw new Error("PROJECT_SECRETS_KEY not set — cannot store a key.");
  const enc = encryptSecret(plain.trim());
  const { error } = await sb
    .from("project_secrets")
    .upsert(
      { project_key: projectKey, anthropic_key_enc: enc, updated_at: new Date().toISOString() },
      { onConflict: "project_key" },
    );
  if (error) throw new Error(error.message);
}

/** A project's BYO Anthropic key (decrypted), or null if none / unconfigured. */
export async function getProjectAnthropicKey(projectKey: string): Promise<string | null> {
  if (!secretsConfigured()) return null;
  const sb = supabaseAdmin;
  if (!sb) return null;
  const { data } = await sb
    .from("project_secrets")
    .select("anthropic_key_enc")
    .eq("project_key", projectKey)
    .maybeSingle();
  const enc = (data as { anthropic_key_enc?: string } | null)?.anthropic_key_enc;
  return enc ? decryptSecret(enc) : null;
}
