import "server-only";

import { supabase } from "./supabase";
import {
  seedTasks,
  seedInbox,
  seedSocial,
  type AgentTask,
  type InboxMessage,
  type SocialPost,
  type TaskCategory,
  type TaskStatus,
} from "./agent";
import { rowToFeedItem, type DirectiveRow } from "./directives";
import type { FeedItem } from "./console";
import type { Learning, LearningCategory } from "./learnings";
import type { Project } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT STATE — live read with per-panel fallback
//
// Reads the agent_* tables (written by the per-project runtime; see
// docs/agent-runtime.md) and maps them to the same shapes the UI already
// renders from lib/agent.ts. Each panel falls back to its seed independently:
// until the runtime writes rows for a project, that panel shows the simulated
// seed; the moment real rows exist, the panel goes live — no UI change needed.
// Mirrors the live/fallback pattern in lib/queries.ts. Server-only.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentState {
  tasks: AgentTask[];
  inbox: InboxMessage[];
  social: SocialPost[];
  /** Persisted steering directives/proposals, newest first ([] until any). */
  directives: FeedItem[];
  /** True when at least one panel came from real rows this request. */
  live: boolean;
}

/** Compact relative-time label from an ISO timestamp. */
function rel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

interface TaskRow {
  id: number;
  title: string;
  detail: string;
  category: string;
  status: string;
  created_at: string;
}
interface EmailRow {
  id: number;
  direction: string;
  party: string;
  subject: string;
  preview: string;
  created_at: string;
}
interface PostRow {
  id: number;
  platform: string;
  body: string;
  likes: number;
  replies: number;
  created_at: string;
}

const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];
const STATUSES: TaskStatus[] = ["todo", "building", "shipped", "blocked"];

export async function getAgentState(p: Project): Promise<AgentState> {
  const fallback: AgentState = {
    tasks: seedTasks(p),
    inbox: seedInbox(p),
    social: seedSocial(p),
    directives: [],
    live: false,
  };
  if (!supabase) return fallback;

  try {
    const [t, e, s, d] = await Promise.all([
      supabase
        .from("agent_tasks")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("agent_emails")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("agent_posts")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("directives")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const tasks: AgentTask[] = ((t.data as TaskRow[] | null) ?? []).map((r) => ({
      id: `t${r.id}`,
      title: r.title,
      detail: r.detail,
      category: CATEGORIES.includes(r.category as TaskCategory)
        ? (r.category as TaskCategory)
        : "feature",
      status: STATUSES.includes(r.status as TaskStatus)
        ? (r.status as TaskStatus)
        : "todo",
      at: rel(r.created_at),
    }));

    const inbox: InboxMessage[] = ((e.data as EmailRow[] | null) ?? []).map(
      (r) => ({
        id: `m${r.id}`,
        direction: r.direction === "in" ? "in" : "out",
        party: r.party,
        subject: r.subject,
        preview: r.preview,
        at: rel(r.created_at),
      })
    );

    const social: SocialPost[] = ((s.data as PostRow[] | null) ?? []).map(
      (r) => ({
        id: `s${r.id}`,
        platform: r.platform as SocialPost["platform"],
        text: r.body,
        at: rel(r.created_at),
        likes: r.likes ?? 0,
        replies: r.replies ?? 0,
      })
    );

    const directives: FeedItem[] = ((d.data as DirectiveRow[] | null) ?? []).map(
      (r) => rowToFeedItem(r, rel(r.created_at))
    );

    return {
      tasks: tasks.length ? tasks : fallback.tasks,
      inbox: inbox.length ? inbox : fallback.inbox,
      social: social.length ? social : fallback.social,
      directives,
      live:
        tasks.length > 0 ||
        inbox.length > 0 ||
        social.length > 0 ||
        directives.length > 0,
    };
  } catch {
    return fallback;
  }
}

interface LearningRow {
  id: string;
  category: string;
  insight: string;
  source: string;
  upvotes: number;
  created_at: string;
}

/**
 * Top cross-project learnings (A5), highest-upvoted first. Read by every agent
 * tick and surfaced in the UI. Returns [] if unconfigured or on failure — the
 * caller treats an empty layer as "no shared learnings yet".
 */
export async function getTopLearnings(limit = 6): Promise<Learning[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("learnings")
      .select("*")
      .order("upvotes", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as LearningRow[]).map((r) => ({
      id: r.id,
      category: r.category as LearningCategory,
      insight: r.insight,
      source: r.source,
      upvotes: r.upvotes,
      at: r.created_at,
    }));
  } catch {
    return [];
  }
}
