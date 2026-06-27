// Curate the agent's backlog — the founder's lever over "what the agent builds
// next". The agent ranks its `todo` queue by curated impact (lib/agent-backlog):
// founder/holder asks outrank its own self-groomed work, and an explicit
// priority wins outright. This script is how the founder sets that priority /
// adds a top-priority task, so the next tick pulls it as backlog #1.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/curate-backlog.ts --list
//   …--set <taskId> --priority 120 [--source founder]      # re-rank an existing task
//   …--add "Redesign the token-page header" [--detail "…"] [--priority 120] [--category feature]
//
// --source defaults to "founder" for --add (it's your ask) and is left unchanged
// for --set unless passed. Project defaults to LOOP (--project <key> to override).
import { supabaseAdmin } from "../lib/supabase";
import { rankBacklog, effectivePriority, type TaskSource } from "../lib/agent-backlog";
import type { AgentTask, TaskCategory } from "../lib/agent";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const PROJECT = flag("project") ?? "loop";
const SOURCES: TaskSource[] = ["founder", "holder", "agent"];
const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

(async () => {
  const sb = supabaseAdmin;
  if (!sb) die("SUPABASE_SERVICE_ROLE_KEY not set — cannot write the backlog.");

  // --- list (default) ---
  if (has("list") || (!has("set") && !has("add"))) {
    const { data } = await sb
      .from("agent_tasks")
      .select("id,title,category,status,priority,source,created_at")
      .eq("project_key", PROJECT)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as {
      id: number; title: string; category: string; status: string; priority: number | null; source: string | null;
    }[];
    const asTasks = rows.map((r) => ({
      id: String(r.id), title: r.title, detail: "", category: r.category as TaskCategory,
      status: r.status, at: "", priority: r.priority ?? undefined, source: (r.source as TaskSource) ?? undefined,
    })) as (AgentTask & { status: string })[];
    const { ranked } = rankBacklog(asTasks);
    console.log(`\nBACKLOG (todo, ranked) — project ${PROJECT}:\n`);
    if (!ranked.length) console.log("  (empty)");
    ranked.forEach((t, i) => {
      const src = t.source ?? "agent";
      console.log(`  #${i + 1}  id=${t.id}  p${effectivePriority(t)}  ${src === "agent" ? "       " : src.toUpperCase().padEnd(7)}  (${t.category})  ${t.title}`);
    });
    const inflight = rows.filter((r) => r.status === "building" || r.status === "blocked");
    if (inflight.length) {
      console.log(`\nIN FLIGHT:`);
      inflight.forEach((r) => console.log(`  id=${r.id}  [${r.status}]  ${r.title}`));
    }
    console.log("");
    return;
  }

  // --- set: re-rank / re-source an existing task ---
  if (has("set")) {
    const id = flag("set");
    if (!id) die("--set needs a task id (see --list)");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const pr = flag("priority");
    if (pr !== undefined) {
      const n = Number(pr);
      if (!Number.isInteger(n)) die("--priority must be an integer");
      patch.priority = n;
    }
    const src = flag("source");
    if (src !== undefined) {
      if (!SOURCES.includes(src as TaskSource)) die(`--source must be one of ${SOURCES.join("/")}`);
      patch.source = src;
    }
    if (Object.keys(patch).length === 1) die("nothing to set — pass --priority and/or --source");
    const { error, data } = await sb.from("agent_tasks").update(patch).eq("id", id).eq("project_key", PROJECT).select("title").maybeSingle();
    if (error) die(error.message);
    if (!data) die(`no task id=${id} in project ${PROJECT}`);
    console.log(`✓ updated id=${id} (${(data as { title: string }).title}): ${JSON.stringify(patch)}`);
    return;
  }

  // --- add: insert a curated founder task straight onto the backlog ---
  if (has("add")) {
    const title = flag("add");
    if (!title) die('--add needs a title, e.g. --add "Redesign the token-page header"');
    const category = (flag("category") as TaskCategory) ?? "feature";
    if (!CATEGORIES.includes(category)) die(`--category must be one of ${CATEGORIES.join("/")}`);
    const source = (flag("source") as TaskSource) ?? "founder";
    if (!SOURCES.includes(source)) die(`--source must be one of ${SOURCES.join("/")}`);
    const priority = flag("priority") !== undefined ? Number(flag("priority")) : 120; // above the founder base band by default
    if (!Number.isInteger(priority)) die("--priority must be an integer");
    const { error, data } = await sb
      .from("agent_tasks")
      .insert({ project_key: PROJECT, title, detail: flag("detail") ?? "", category, status: "todo", priority, source })
      .select("id")
      .maybeSingle();
    if (error) die(error.message);
    console.log(`✓ added todo id=${(data as { id: number }).id}  p${priority}  ${source}  (${category})  ${title}`);
    return;
  }
})().catch((e) => {
  console.error("curate-backlog failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
