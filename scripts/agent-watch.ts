// ─────────────────────────────────────────────────────────────────────────────
// agent-watch — a live terminal dashboard for the LOOP agent.
//
//   npm run agent:watch            # auto-refreshing live view (15s)
//   npm run agent:watch -- --once  # render one snapshot and exit
//   npm run agent:watch -- --interval=5
//
// One screen that answers "what is the agent doing right now?" by joining every
// real signal: the on-chain treasury (the wake/sleep gate), the compute ledger
// (Anthropic runway), the Trigger.dev E2B sessions (is it building this second?),
// the task queue + outcomes, the activity feed, and the real commits it pushed.
//
// Standalone on purpose: it loads .env.local itself and talks to each source over
// raw HTTP / supabase-js, so it never imports the `server-only` libs and runs as a
// plain `tsx` script. Read-only — it observes, it never ticks or mutates anything.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── tiny .env.local loader (so the command is a single clean invocation) ──
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}
loadEnv();

// ── args ──
const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const NO_CLEAR = args.includes("--no-clear");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const INTERVAL_S = Math.max(3, Number(intervalArg?.split("=")[1] ?? 15) || 15);
const PROJECT_KEY = "loop";
const TREASURY = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";
const REPO = "LoopLabsfun/loop";
const COOLDOWN_MIN = Number(process.env.AGENT_TICK_COOLDOWN_MIN) || 240; // prod default
const WAKE_SOL = 0.01; // MIN_TREASURY_SOL (lib/budget)

// ── ANSI ──
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const c = (color: keyof typeof C, s: string) => `${C[color]}${s}${C.reset}`;
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ── helpers ──
const WIDTH = Math.min(Math.max(process.stdout.columns || 84, 64), 110);

function rule(label = "") {
  if (!label) return c("gray", "─".repeat(WIDTH));
  const tag = ` ${label} `;
  const left = 2;
  const right = Math.max(0, WIDTH - left - tag.length);
  return (
    c("gray", "─".repeat(left)) +
    c("cyan", c("bold", tag)) +
    c("gray", "─".repeat(right))
  );
}

function row(s: string) {
  // truncate to terminal width (accounting for ANSI)
  const visible = stripAnsi(s);
  if (visible.length <= WIDTH) return s;
  // naive truncation on the visible string (good enough; we build rows simply)
  return s.slice(0, WIDTH - 1 + (s.length - visible.length)) + "…";
}

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? (m % 60) + "m" : ""}`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function trunc(s: string, n: number): string {
  s = (s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── data sources ──
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false },
        global: { fetch: (i: any, x?: any) => fetch(i, { ...x, cache: "no-store" }) },
      })
    : null;

async function treasurySol(): Promise<number | null> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [TREASURY],
      }),
    });
    const j = await res.json();
    const lamports = j?.result?.value;
    return typeof lamports === "number" ? lamports / 1e9 : null;
  } catch {
    return null;
  }
}

interface Run {
  id: string;
  status: string;
  createdAt: string;
  taskIdentifier: string;
}
async function triggerRuns(): Promise<Run[] | null> {
  const k = process.env.TRIGGER_SECRET_KEY;
  if (!k) return null;
  try {
    const res = await fetch("https://api.trigger.dev/api/v1/runs?limit=6", {
      headers: { Authorization: `Bearer ${k}` },
    });
    const j = await res.json();
    return Array.isArray(j?.data) ? j.data : [];
  } catch {
    return null;
  }
}

interface Commit {
  sha: string;
  msg: string;
  date: string;
  author: string;
}
async function commits(): Promise<Commit[] | null> {
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN)
      headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=6`,
      { headers },
    );
    if (!res.ok) return null;
    const j = await res.json();
    if (!Array.isArray(j)) return null;
    return j.map((x: any) => ({
      sha: x.sha?.slice(0, 7) ?? "?",
      msg: (x.commit?.message ?? "").split("\n")[0],
      date: x.commit?.author?.date ?? x.commit?.committer?.date ?? "",
      author: x.author?.login ?? x.commit?.author?.name ?? "?",
    }));
  } catch {
    return null;
  }
}

async function snapshot() {
  const [
    sol,
    runs,
    cmts,
    tasksRes,
    actionsRes,
    postsRes,
    ledgerRes,
    dirRes,
  ] = await Promise.all([
    treasurySol(),
    triggerRuns(),
    commits(),
    sb
      ?.from("agent_tasks")
      .select("id,title,status,category,updated_at,last_outcome")
      .eq("project_key", PROJECT_KEY)
      .order("updated_at", { ascending: false })
      .limit(10),
    sb
      ?.from("agent_actions")
      .select("kind,disposition,amount_sol,body,created_at")
      .eq("project_key", PROJECT_KEY)
      .order("created_at", { ascending: false })
      .limit(5),
    sb
      ?.from("agent_posts")
      .select("platform,body,created_at")
      .eq("project_key", PROJECT_KEY)
      .order("created_at", { ascending: false })
      .limit(4),
    sb?.from("compute_ledger").select("*").eq("project_key", PROJECT_KEY).maybeSingle(),
    sb
      ?.from("directives")
      .select("id,kind,body,status,created_at")
      .eq("project_key", PROJECT_KEY)
      .order("created_at", { ascending: false })
      .limit(4),
  ]);
  return {
    sol,
    runs,
    cmts,
    tasks: (tasksRes as any)?.data ?? null,
    actions: (actionsRes as any)?.data ?? null,
    posts: (postsRes as any)?.data ?? null,
    ledger: (ledgerRes as any)?.data ?? null,
    directives: (dirRes as any)?.data ?? null,
  };
}

// ── render ──
const statusColor = (s: string): keyof typeof C => {
  const u = s.toUpperCase();
  if (["COMPLETED", "SHIPPED"].includes(u)) return "green";
  if (["EXECUTING", "BUILDING", "QUEUED", "WAITING", "DEQUEUED", "REATTEMPTING"].includes(u))
    return "yellow";
  if (["FAILED", "CANCELED", "CRASHED", "TIMED_OUT", "EXPIRED"].includes(u)) return "red";
  return "gray";
};

const taskIcon = (s: string) =>
  s === "shipped" ? c("green", "✓") : s === "building" ? c("yellow", "⚙") : s === "todo" ? c("blue", "○") : c("gray", "·");

function render(s: Awaited<ReturnType<typeof snapshot>>) {
  const out: string[] = [];
  const now = new Date();
  const clock = now.toISOString().slice(11, 19);

  // ── header ──
  const title = c("magenta", c("bold", "◉ LOOP AGENT")) + c("gray", " · live");
  out.push(
    title + " ".repeat(Math.max(1, WIDTH - stripAnsi(title).length - 12)) + c("gray", `${clock} UTC`),
  );
  out.push("");

  // STATE
  let state: string;
  let dot: string;
  if (s.sol === null) {
    state = "unknown"; dot = c("gray", "●");
  } else if (s.sol >= WAKE_SOL) {
    state = "active"; dot = c("green", "●");
  } else {
    state = "asleep"; dot = c("yellow", "●");
  }
  const solStr =
    s.sol === null ? c("gray", "—") : `${s.sol.toFixed(4)} SOL`;
  const gate =
    s.sol !== null && s.sol < WAKE_SOL
      ? c("yellow", `(needs ≥ ${WAKE_SOL} to wake)`)
      : c("gray", `(wake gate ${WAKE_SOL})`);
  out.push(`  ${dot} ${c("bold", state.padEnd(8))}  treasury ${c("cyan", solStr)}  ${gate}`);

  // COMPUTE
  if (s.ledger) {
    const rem = (s.ledger.credited_usd ?? 0) - (s.ledger.consumed_usd ?? 0);
    const remStr = `$${rem.toFixed(2)}`;
    const remCol = rem <= 0 ? "red" : rem < 5 ? "yellow" : "green";
    const flag = rem <= 0 ? c("red", " ⚠ over budget — top up billing") : "";
    out.push(
      `  ${c("gray", "compute ")}${c(remCol, remStr.padEnd(9))} ${c("gray", `credited $${(s.ledger.credited_usd ?? 0).toFixed(2)} · consumed $${(s.ledger.consumed_usd ?? 0).toFixed(2)}`)}${flag}`,
    );
  }

  // COOLDOWN — next eligible tick = last task/post activity + cooldown
  const lastTask = s.tasks?.[0]?.updated_at;
  const lastPost = s.posts?.[0]?.created_at;
  const lastAct = [lastTask, lastPost]
    .filter(Boolean)
    .map((x) => new Date(x).getTime())
    .sort((a, b) => b - a)[0];
  if (lastAct) {
    const next = lastAct + COOLDOWN_MIN * 60_000;
    const remMs = next - Date.now();
    const cdStr =
      remMs <= 0
        ? c("green", "eligible now")
        : c("yellow", `~${Math.ceil(remMs / 60_000)}m`);
    out.push(
      `  ${c("gray", "cooldown ")}${cdStr}  ${c("gray", `(last activity ${ago(new Date(lastAct).toISOString())} ago · gap ${COOLDOWN_MIN}m)`)}`,
    );
  }

  // ── NOW: trigger.dev session ──
  out.push("");
  out.push(rule("E2B SESSIONS (trigger.dev)"));
  if (s.runs === null) {
    out.push("  " + c("gray", "trigger.dev unreachable"));
  } else if (s.runs.length === 0) {
    out.push("  " + c("gray", "no runs"));
  } else {
    const live = s.runs.find((r) =>
      ["EXECUTING", "QUEUED", "WAITING", "REATTEMPTING", "DEQUEUED"].includes(
        r.status.toUpperCase(),
      ),
    );
    if (live)
      out.push(
        "  " +
          c("yellow", "▶ BUILDING NOW  ") +
          c("bold", live.id) +
          c("gray", `  ${live.status} · ${ago(live.createdAt)}`),
      );
    for (const r of s.runs.slice(0, 4)) {
      const st = c(statusColor(r.status), r.status.padEnd(10));
      out.push(
        row(`  ${st} ${c("gray", ago(r.createdAt).padStart(4))}  ${c("dim", r.id)}`),
      );
    }
  }

  // ── TASKS ──
  out.push("");
  out.push(rule("TASKS"));
  if (!s.tasks) {
    out.push("  " + c("gray", "db unreachable"));
  } else {
    const queue = s.tasks.filter((t: any) => t.status === "building" || t.status === "todo");
    const shipped = s.tasks.filter((t: any) => t.status === "shipped").slice(0, 4);
    for (const t of [...queue, ...shipped].slice(0, 7)) {
      const out2 = t.last_outcome ? c("gray", `  ↳ ${trunc(t.last_outcome, WIDTH - 8)}`) : "";
      out.push(
        row(
          `  ${taskIcon(t.status)} ${c("gray", t.status.padEnd(8))} ${trunc(t.title, WIDTH - 28)} ${c("gray", ago(t.updated_at))}`,
        ),
      );
      if (out2) out.push(row(out2));
    }
  }

  // ── COMMITS ──
  out.push("");
  out.push(rule("COMMITS · main"));
  if (s.cmts === null) {
    out.push("  " + c("gray", "github unreachable"));
  } else {
    for (const cm of s.cmts.slice(0, 5)) {
      const who = cm.author === "looplabs-fun" ? c("magenta", cm.author) : c("gray", cm.author);
      out.push(
        row(`  ${c("yellow", cm.sha)}  ${trunc(cm.msg, WIDTH - 34)} ${c("gray", ago(cm.date))} ${who}`),
      );
    }
  }

  // ── FEED (actions) ──
  if (s.actions && s.actions.length) {
    out.push("");
    out.push(rule("ON-CHAIN ACTIONS"));
    for (const a of s.actions) {
      out.push(
        row(`  ${c("gray", ago(a.created_at).padStart(4))}  ${c("cyan", (a.kind ?? "").padEnd(8))} ${trunc(a.body, WIDTH - 22)}`),
      );
    }
  }

  // ── DIRECTIVES (steering / injection watch) ──
  if (s.directives && s.directives.length) {
    out.push("");
    out.push(rule("DIRECTIVES (steering)"));
    for (const d of s.directives) {
      const st = (d.status ?? "").toLowerCase();
      const col: keyof typeof C =
        st === "declined" ? "red" : st === "adopted" || st === "done" ? "green" : "gray";
      out.push(
        row(`  ${c("gray", ago(d.created_at).padStart(4))}  ${c(col, (d.status ?? "?").padEnd(9))} ${c("gray", (d.kind ?? "").padEnd(8))} ${trunc(d.body, WIDTH - 32)}`),
      );
    }
  }

  // ── POSTS ──
  if (s.posts && s.posts.length) {
    out.push("");
    out.push(rule("SOCIAL POSTS"));
    for (const p of s.posts) {
      out.push(
        row(`  ${c("gray", ago(p.created_at).padStart(4))}  ${c("blue", (p.platform ?? "?").padEnd(8))} ${trunc(p.body, WIDTH - 22)}`),
      );
    }
  }

  out.push("");
  out.push(
    c("gray", ONCE ? "  snapshot · --once" : `  refresh ${INTERVAL_S}s · ^C to quit`),
  );
  return out.join("\n");
}

async function tick() {
  let frame: string;
  try {
    const s = await snapshot();
    frame = render(s);
  } catch (e) {
    frame = c("red", `  error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!NO_CLEAR && !ONCE) process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(frame + "\n");
}

(async () => {
  if (!sb) {
    console.error(
      c("red", "Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL + a key in .env.local"),
    );
    process.exit(1);
  }
  await tick();
  if (ONCE) return;
  const timer = setInterval(tick, INTERVAL_S * 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.stdout.write("\n" + c("gray", "stopped.") + "\n");
    process.exit(0);
  });
})();
