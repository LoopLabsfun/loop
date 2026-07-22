"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { runAssist } from "@/lib/compute-work";
import { computeDeviceId, computeDeviceName, buildHoodLinkMessage } from "@/lib/compute-message";

// The public beta Loop Compute client — the browser IS the node. Zero install:
// connect a wallet, sign once (enrollment mints a device token bound to the
// wallet), and this tab starts preparing real backlog work for project agents.
// The work unit is deterministic (lib/compute-work.ts); the server recomputes
// and verifies every submission, so the open pool stays spoof-proof. Native
// CLI / menu-bar clients are the power-user tier — this is the everyone tier.

const PROJECT = "loop";
const POLL_MS = 60_000;
const MAX_LOG = 6;

interface BacklogTask {
  id: number;
  projectKey: string;
  title: string;
  detail: string;
  status: string;
  priority: number;
  category: string;
}

type NodeStatus = "off" | "enrolling" | "running" | "error";

export function BrowserNode() {
  const wallet = useWallet();
  const hood = useHoodWallet();
  const [status, setStatus] = useState<NodeStatus>("off");
  const [log, setLog] = useState<string[]>([]);
  const [jobsDone, setJobsDone] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [hoodLinked, setHoodLinked] = useState(false);
  const [linkingHood, setLinkingHood] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const say = useCallback((line: string) => {
    const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setLog((l) => [`${at}  ${line}`, ...l].slice(0, MAX_LOG));
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setStatus("off");
  }, []);

  // Redundant treasury-balance check — Loop Compute's first job with ZERO
  // Claude/LLM anywhere in its lifecycle (unlike the prep-brief work below,
  // which only exists to feed an agent's prompt). This device reads a
  // project treasury's balance independently; the server cross-checks it
  // against every other device's read for the same 5-minute window
  // (lib/treasury-checks.ts). Best-effort, silent on failure — never
  // disrupts the main backlog pass.
  const treasuryCheckPass = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const listRes = await fetch("/api/compute/treasury-check");
      if (!listRes.ok) return;
      const { projects } = (await listRes.json()) as { projects: { projectKey: string; wallet: string }[] };
      for (const p of projects) {
        const rpcRes = await fetch("/api/rpc?cluster=mainnet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [p.wallet] }),
        });
        if (!rpcRes.ok) continue;
        const rpcJson = (await rpcRes.json()) as { result?: { value?: number } };
        const lamports = rpcJson.result?.value;
        if (typeof lamports !== "number") continue;
        await fetch("/api/compute/treasury-check", {
          method: "POST",
          headers: { "content-type": "application/json", "x-device-token": token },
          body: JSON.stringify({ projectKey: p.projectKey, wallet: p.wallet, lamports }),
        });
      }
    } catch {
      /* best-effort — the backlog pass is the primary job */
    }
  }, []);

  // One work pass: backlog → claim → compute → submit. Never throws.
  const pass = useCallback(async () => {
    void treasuryCheckPass();
    const address = wallet.address;
    const token = tokenRef.current;
    if (!address || !token || busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await fetch(`/api/compute/backlog?project=${PROJECT}`);
      if (!res.ok) throw new Error(`backlog ${res.status}`);
      const { tasks, preppedTaskIds } = (await res.json()) as {
        tasks: BacklogTask[];
        preppedTaskIds: number[];
      };
      const prepped = new Set(preppedTaskIds);
      const task = tasks.find((t) => !prepped.has(t.id));
      if (!task) {
        say("backlog fully prepped — standing by");
        return;
      }

      const claim = await fetch("/api/device-jobs/claim", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-token": token },
        body: JSON.stringify({
          projectKey: PROJECT,
          taskId: task.id,
          deviceName: computeDeviceName(address),
        }),
      });
      if (claim.ok) {
        const c = (await claim.json()) as { granted?: boolean };
        if (c.granted === false) {
          say(`task #${task.id} taken by another device — skip`);
          return;
        }
      }

      const { result, resultHash } = await runAssist({
        kind: "agent_assist",
        projectKey: PROJECT,
        taskId: task.id,
        title: task.title,
        detail: task.detail,
        status: task.status,
        priority: task.priority,
        category: task.category,
        repo: null,
      });

      const submit = await fetch("/api/device-assists", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-token": token },
        body: JSON.stringify({
          projectKey: PROJECT,
          taskId: task.id,
          jobId: `web-${Date.now().toString(36)}`,
          title: result.title,
          deviceName: computeDeviceName(address),
          complexity: result.complexity,
          keywords: result.keywords,
          prepBrief: result.prepBrief,
          resultHash,
          payoutAddress: address,
        }),
      });
      if (!submit.ok) {
        const err = (await submit.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `submit ${submit.status}`);
      }
      setJobsDone((n) => n + 1);
      say(`✓ task #${task.id} prepped + verified (${result.complexity})`);
    } catch (e) {
      say(`⚠ ${e instanceof Error ? e.message : "pass failed"}`);
    } finally {
      busyRef.current = false;
    }
  }, [wallet.address, say, treasuryCheckPass]);

  const start = useCallback(async () => {
    const address = wallet.address;
    if (!address) {
      wallet.toggle();
      return;
    }
    setLastError(null);
    const key = `loop-compute-token:${address}`;
    let token = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (!token) {
      setStatus("enrolling");
      try {
        const proof = await wallet.signComputeEnrollProof(address);
        if (!proof) throw new Error("wallet can't sign messages");
        const res = await fetch("/api/compute/enroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: address, proof }),
        });
        const json = (await res.json().catch(() => null)) as
          | { token?: string; error?: string }
          | null;
        if (!res.ok || !json?.token) throw new Error(json?.error || "enrollment failed");
        token = json.token;
        window.localStorage.setItem(key, token);
        say("device enrolled — token bound to your wallet");
      } catch (e) {
        setStatus("error");
        setLastError(e instanceof Error ? e.message : "enrollment failed");
        return;
      }
    }
    tokenRef.current = token;
    setHoodLinked(token.startsWith("dt2."));
    setStatus("running");
    say(`node ${computeDeviceName(address)} online`);
    void pass();
    timerRef.current = setInterval(() => void pass(), POLL_MS);
  }, [wallet, say, pass]);

  // Link a Hood (EVM) payout wallet alongside the Solana one this device
  // already enrolled with — needed once a task can be funded from either
  // chain's treasury (LOOP-Solana pays SOL, LOOP-Hood pays ETH). Both wallets
  // sign the SAME message text; reissues the device token as v2 on success.
  const linkHood = useCallback(async () => {
    const solAddress = wallet.address;
    if (!solAddress) return;
    setLastError(null);
    setLinkingHood(true);
    try {
      if (!hood.connected) await hood.connect();
      const hoodAddress = hood.address;
      if (!hoodAddress) throw new Error("connect an EVM wallet first");
      const ts = Date.now();
      const [proof, hoodSignature] = await Promise.all([
        wallet.signHoodLinkProof(hoodAddress, ts),
        hood.signMessage(buildHoodLinkMessage(solAddress, hoodAddress, ts)),
      ]);
      if (!proof) throw new Error("solana wallet can't sign messages");
      const res = await fetch("/api/compute/link-hood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: solAddress, proof, hoodAddress, hoodSignature }),
      });
      const json = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !json?.token) throw new Error(json?.error || "link failed");
      tokenRef.current = json.token;
      window.localStorage.setItem(`loop-compute-token:${solAddress}`, json.token);
      setHoodLinked(true);
      say(`Hood payout linked — stored for when $LOOP is live on Hood`);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "hood link failed");
    } finally {
      setLinkingHood(false);
    }
  }, [wallet, hood, say]);

  // Stop cleanly if the wallet disconnects mid-run or the view unmounts.
  useEffect(() => {
    if (status === "running" && !wallet.connected) stop();
    return stop;
    // `status` is read but MUST NOT be a dependency: the cleanup is `stop`, so
    // re-running this effect on every status change would stop the node the
    // instant it starts. Only the wallet-disconnect transition should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected]);

  const running = status === "running";
  return (
    <div className="bg-surface border-[1.5px] border-accent-300 rounded-[16px] px-5 py-[18px] mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="font-display font-semibold text-[15px]">
          Run a node — right here <span className="font-mono text-[10px] text-accent-text align-middle ml-1 px-[6px] py-[2px] rounded-[5px] border border-accent-300">BETA</span>
        </div>
        <span className="inline-flex items-center gap-[6px] font-mono text-[11px] text-muted">
          <span
            className={`w-[7px] h-[7px] rounded-full ${
              running ? "bg-pos animate-pulseFast" : status === "enrolling" ? "bg-warn" : "bg-faint"
            }`}
          />
          {running ? "ONLINE" : status === "enrolling" ? "ENROLLING" : "OFFLINE"}
        </span>
      </div>
      <p className="text-[13px] text-muted mt-0 mb-3">
        No install — this tab becomes a Loop Compute device. It claims open backlog
        items, prepares the brief on your machine, and submits it; the server
        re-verifies every result. Assists are credited to your connected wallet.
        Keep the tab open while the node runs.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        {!wallet.connected ? (
          <button
            onClick={wallet.toggle}
            className="font-mono text-[12.5px] px-4 py-[8px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity"
          >
            Connect wallet to start
          </button>
        ) : running ? (
          <button
            onClick={stop}
            className="font-mono text-[12.5px] px-4 py-[8px] rounded-[10px] border border-line-3 text-muted hover:text-ink transition-colors"
          >
            Stop node
          </button>
        ) : (
          <button
            onClick={() => void start()}
            disabled={status === "enrolling"}
            className="font-mono text-[12.5px] px-4 py-[8px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {status === "enrolling" ? "Sign in your wallet…" : "Start node"}
          </button>
        )}
        <span className="font-mono text-[11.5px] text-faint">
          {jobsDone > 0 ? `${jobsDone} assist${jobsDone > 1 ? "s" : ""} this session` : "prepping $LOOP backlog"}
        </span>
      </div>

      {/* LOOP will soon be funded from two chains (Solana + Hood) — a task's
          reward pays in whichever chain funded it, so a device needs both
          payout wallets on file. Shown only once enrolled; optional. */}
      {wallet.connected && status !== "off" && (
        <div className="mt-3 pt-3 border-t border-line-4 flex items-center gap-3 flex-wrap">
          {hoodLinked ? (
            <span className="font-mono text-[11.5px] text-pos">
              ✓ Hood payout linked ({hood.address ? `${hood.address.slice(0, 6)}…${hood.address.slice(-4)}` : "EVM wallet"})
            </span>
          ) : (
            <>
              <button
                onClick={() => void linkHood()}
                disabled={linkingHood}
                className="font-mono text-[11.5px] px-3 py-[6px] rounded-[9px] border border-line-3 text-muted hover:text-ink hover:border-line-hover transition-colors disabled:opacity-60"
              >
                {linkingHood ? "Sign in both wallets…" : "+ Link Hood wallet (for $LOOP on Hood, coming)"}
              </button>
              <span className="font-mono text-[10.5px] text-faint">
                optional — rewards pay in $LOOP on Solana today
              </span>
            </>
          )}
        </div>
      )}

      {lastError && (
        <p className="font-mono text-[11.5px] text-[var(--neg)] mt-2 mb-0">{lastError}</p>
      )}
      {log.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line-4 font-mono text-[11px] text-muted flex flex-col gap-[3px]">
          {log.map((l, i) => (
            <div key={i} className={i === 0 ? "text-ink" : ""}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
