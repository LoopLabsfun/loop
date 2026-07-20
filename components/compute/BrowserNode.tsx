"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { runAssist } from "@/lib/compute-work";
import { computeDeviceId, computeDeviceName } from "@/lib/compute-message";

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
  const [status, setStatus] = useState<NodeStatus>("off");
  const [log, setLog] = useState<string[]>([]);
  const [jobsDone, setJobsDone] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
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

  // One work pass: backlog → claim → compute → submit. Never throws.
  const pass = useCallback(async () => {
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
  }, [wallet.address, say]);

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
    setStatus("running");
    say(`node ${computeDeviceName(address)} online`);
    void pass();
    timerRef.current = setInterval(() => void pass(), POLL_MS);
  }, [wallet, say, pass]);

  // Stop cleanly if the wallet disconnects mid-run or the view unmounts.
  useEffect(() => {
    if (status === "running" && !wallet.connected) stop();
    return stop;
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
