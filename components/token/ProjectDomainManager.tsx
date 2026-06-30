"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM DOMAIN MANAGER — self-contained UI shared by the creator surface
// (/token, components/token/ProjectSettings) and the LOOP super-admin console
// (/admin). It talks to /api/admin/projects/domain, which authorizes the same two
// roles, so the SAME widget works for both. Attach a domain → it shows the DNS
// records to set → Verify re-checks → once verified the project links to it.
// ─────────────────────────────────────────────────────────────────────────────

interface DomainInfo {
  name: string;
  verified: boolean;
  dns: { type: string; name: string; value: string }[];
}

export function ProjectDomainManager({
  projectKey,
  currentDomain,
  defaultUrl,
}: {
  projectKey: string;
  currentDomain: string | null;
  /** The default Vercel URL to show as the fallback (e.g. build-loop-labs-fun.vercel.app). */
  defaultUrl?: string;
}) {
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/projects/domain?key=${encodeURIComponent(projectKey)}`, {
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as { domains?: DomainInfo[]; note?: string };
        setDomains(j.domains ?? []);
      }
    } finally {
      setLoaded(true);
    }
  }, [projectKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: "attach" | "verify" | "detach", domain: string) {
    setErr(null);
    setOk(null);
    setBusy(`${action}:${domain}`);
    try {
      const r = await fetch("/api/admin/projects/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: projectKey, action, domain }),
      });
      const j = (await r.json()) as { ok?: boolean; note?: string; domains?: DomainInfo[] };
      if (j.domains) setDomains(j.domains);
      if (j.note) (j.ok ? setOk : setErr)(j.note);
      if (action === "attach") setValue("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[10px] uppercase tracking-[0.04em] text-faint font-mono">Custom domain</div>
      <p className="text-[11.5px] text-muted leading-[1.45]">
        Point an external domain at this project.
        {defaultUrl && (
          <>
            {" Default: "}
            <span className="font-mono text-body">{defaultUrl}</span>
          </>
        )}
        {currentDomain && (
          <>
            {" · live on "}
            <a
              href={`https://${currentDomain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-pos hover:underline"
            >
              {currentDomain}
            </a>
          </>
        )}
      </p>

      {err && <div className="text-[11.5px] text-neg font-mono">{err}</div>}
      {ok && <div className="text-[11.5px] text-pos font-mono">{ok}</div>}

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[10px] uppercase tracking-[0.02em] text-faint">Add a domain</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="app.yourdomain.com"
            className="bg-surface-2 border border-line-3 rounded-[8px] px-2.5 h-[32px] text-[12.5px] text-ink font-mono outline-none focus:border-accent/60 transition-colors"
          />
        </label>
        <DBtn onClick={() => act("attach", value)} busy={busy === `attach:${value}`}>Attach</DBtn>
      </div>

      {loaded && domains.length === 0 && (
        <div className="text-[11px] text-faint">No custom domain yet — the default Vercel URL is live.</div>
      )}

      {domains.map((d) => (
        <div key={d.name} className="border border-line-3 rounded-[10px] p-2.5 bg-surface-2/40 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[12.5px] text-ink">{d.name}</span>
            <span
              className={`font-mono text-[10px] px-2 py-[2px] rounded-full ${
                d.verified ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"
              }`}
            >
              {d.verified ? "verified" : "pending DNS"}
            </span>
            <div className="ml-auto flex gap-1.5">
              {!d.verified && (
                <DBtn onClick={() => act("verify", d.name)} busy={busy === `verify:${d.name}`}>Verify</DBtn>
              )}
              <DBtn onClick={() => act("detach", d.name)} busy={busy === `detach:${d.name}`} danger>Remove</DBtn>
            </div>
          </div>
          {!d.verified && d.dns.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              <div className="text-[11px] text-muted">Set these at your DNS provider, then Verify:</div>
              {d.dns.map((rec, i) => (
                <div key={i} className="font-mono text-[11px] grid grid-cols-[44px_1fr] gap-2 text-body">
                  <span className="text-accent-text">{rec.type}</span>
                  <span className="truncate">
                    <span className="text-faint">{rec.name}</span> → {rec.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DBtn({ children, onClick, busy, danger }: { children: ReactNode; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`font-mono text-[11.5px] px-2.5 py-[6px] rounded-[8px] border transition-colors disabled:opacity-50 ${
        danger ? "border-neg/40 text-neg hover:bg-neg/10" : "border-line-2 hover:bg-surface-2"
      }`}
    >
      {busy ? "…" : children}
    </button>
  );
}
