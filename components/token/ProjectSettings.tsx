"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useWallet } from "@/lib/wallet";
import type { Project } from "@/lib/types";
import { ProjectDomainManager } from "./ProjectDomainManager";

// ─────────────────────────────────────────────────────────────────────────────
// CREATOR PROJECT SETTINGS — a self-serve editor on the project's own token page.
//
// Shown only when the connected wallet IS the project's creator_wallet. The creator
// signs a wallet message (opens a 2h admin session, moves no funds) and can then edit
// their BRAND + SOCIAL (name, description, X/Telegram/Discord/Website), upload a
// logo/banner, and attach an EXTERNAL CUSTOM DOMAIN to their Vercel deployment. The
// same backend powers the LOOP super-admin (/admin); this is the creator's slice —
// economic/safety levers (fee %, prompt, guardrails, BYO key, pause) stay LOOP-only.
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectSettings({ project }: { project: Project }) {
  const wallet = useWallet();
  const isCreator = Boolean(
    wallet.connected &&
      wallet.address &&
      project.creatorWallet &&
      wallet.address === project.creatorWallet,
  );
  const [open, setOpen] = useState(false);

  // The entry point only exists for the project's creator.
  if (!isCreator) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="font-mono text-[11.5px] px-3 py-[6px] rounded-[8px] border border-line-2 text-muted hover:bg-surface-2 hover:text-ink transition-colors"
      >
        {open ? "Close settings" : "⚙ Manage project"}
      </button>
      {open && <Editor project={project} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Editor({ project, onClose }: { project: Project; onClose: () => void }) {
  const wallet = useWallet();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [name, setName] = useState(project.name ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [twitter, setTwitter] = useState(project.twitter ?? "");
  const [telegram, setTelegram] = useState(project.telegram ?? "");
  const [discord, setDiscord] = useState(project.discord ?? "");
  const [website, setWebsite] = useState(project.website ?? "");

  // Probe whether a session cookie is already valid (200) — skips the wallet prompt.
  const probe = useCallback(async (): Promise<boolean> => {
    const r = await fetch(`/api/admin/projects/domain?key=${encodeURIComponent(project.key)}`, {
      cache: "no-store",
    });
    return r.ok;
  }, [project.key]);

  useEffect(() => {
    (async () => {
      try {
        setAuthed(await probe());
      } finally {
        setChecking(false);
      }
    })();
  }, [probe]);

  async function signIn() {
    setErr(null);
    setBusy("signin");
    try {
      const proof = await wallet.signAdminProof(project.key);
      if (!proof) {
        setErr("This wallet can't sign — connect Phantom or Solflare.");
        return;
      }
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: project.key, proof }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "sign-in failed");
        return;
      }
      setAuthed(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setErr(null);
    setOk(null);
    setBusy("save");
    try {
      const r = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: project.key,
          action: "edit",
          fields: { name: name.trim(), description, twitter, telegram, discord, website },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save failed");
      setOk("Saved ✓ — reload to see it everywhere.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 border border-line-2 rounded-[14px] p-4 bg-surface flex flex-col gap-3">
      {err && <div className="text-[12px] text-neg font-mono">{err}</div>}
      {ok && <div className="text-[12px] text-pos font-mono">{ok}</div>}

      {checking ? (
        <div className="text-[12.5px] text-faint font-mono">Checking session…</div>
      ) : !authed ? (
        <div className="text-center py-3">
          <p className="text-[12.5px] text-muted max-w-[380px] mx-auto mb-3">
            Prove you own this project by signing a message with its creator wallet — it
            moves no funds and opens a 2-hour edit session.
          </p>
          <Btn onClick={signIn} busy={busy === "signin"} primary>
            Sign to edit ({wallet.label})
          </Btn>
        </div>
      ) : (
        <>
          {/* Brand + social */}
          <div className="flex flex-col gap-2.5">
            <LInput label="Name" value={name} onChange={setName} />
            <LArea label="Description" value={description} onChange={setDescription} rows={2} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <LInput label="X / Twitter" value={twitter} onChange={setTwitter} mono placeholder="@handle or x.com/…" />
              <LInput label="Telegram" value={telegram} onChange={setTelegram} mono placeholder="@name or t.me/…" />
              <LInput label="Discord" value={discord} onChange={setDiscord} mono placeholder="discord.gg/…" />
              <LInput label="Website" value={website} onChange={setWebsite} mono placeholder="https://…" />
            </div>
            <div className="grid grid-cols-[60px_1fr] gap-2.5 items-end">
              <ImageUpload projectKey={project.key} kind="token" current={project.tokenImageUrl ?? null} circle />
              <ImageUpload projectKey={project.key} kind="banner" current={project.bannerUrl ?? null} />
            </div>
            <div>
              <Btn onClick={save} busy={busy === "save"} primary>Save changes</Btn>
            </div>
          </div>

          {/* Custom domain (shared widget — same one the LOOP admin uses) */}
          <div className="border-t border-line-3 pt-3">
            <ProjectDomainManager
              projectKey={project.key}
              currentDomain={project.domain ?? null}
              defaultUrl={`${vercelSlug(project)}-loop-labs-fun.vercel.app`}
            />
          </div>
        </>
      )}

      <button onClick={onClose} className="self-start font-mono text-[11px] text-faint hover:text-ink mt-1">
        Done
      </button>
    </div>
  );
}

// Best-effort display of the project's default Vercel slug (from the repo name).
function vercelSlug(project: Project): string {
  const fromRepo = project.repo?.replace(/^github\.com\//, "").split("/")[1];
  return (fromRepo || project.key).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

// ── Image upload (reuses the brand-media route; creator-or-admin gated) ──────────
function ImageUpload({
  projectKey,
  kind,
  current,
  circle,
}: {
  projectKey: string;
  kind: "token" | "banner";
  current: string | null;
  circle?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("key", projectKey);
      fd.append("kind", kind);
      fd.append("file", file);
      const r = await fetch("/api/admin/projects/media", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "upload failed");
      setUrl(j.url as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.02em] text-faint">{kind === "token" ? "Logo" : "Banner"}</span>
      <label
        className={`relative flex items-center justify-center overflow-hidden border border-dashed border-line-3 bg-surface-2 cursor-pointer hover:border-line-hover transition-colors ${
          circle ? "h-[60px] w-[60px] rounded-full" : "h-[60px] w-full rounded-[10px]"
        }`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[11px] text-faint">{busy ? "…" : "+ image"}</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={`Upload ${kind} image`}
        />
      </label>
      {err && <span className="text-[11px] text-neg">{err}</span>}
    </div>
  );
}

// ── Small styled controls (token-page tokens) ───────────────────────────────────
function LInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.02em] text-faint">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`bg-surface-2 border border-line-3 rounded-[8px] px-2.5 h-[32px] text-[12.5px] text-ink outline-none focus:border-accent/60 transition-colors ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function LArea({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.02em] text-faint">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="bg-surface-2 border border-line-3 rounded-[8px] px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent/60 transition-colors resize-y leading-[1.4]"
      />
    </label>
  );
}

function Btn({
  children,
  onClick,
  busy,
  danger,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`font-mono text-[11.5px] px-2.5 py-[6px] rounded-[8px] border transition-colors disabled:opacity-50 ${
        primary
          ? "bg-accent text-white border-transparent hover:opacity-90"
          : danger
            ? "border-neg/40 text-neg hover:bg-neg/10"
            : "border-line-2 hover:bg-surface-2"
      }`}
    >
      {busy ? "…" : children}
    </button>
  );
}
