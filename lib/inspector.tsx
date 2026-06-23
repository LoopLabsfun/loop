"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Project } from "./types";
import {
  inspectKindMeta,
  type InspectItem,
  type InspectKindMeta,
} from "./inspect-item";

// ─────────────────────────────────────────────────────────────────────────────
// INSPECTOR — the "click anything → right-side detail drawer" seam (operator mode).
//
// Any element on the token page can call `inspect({kind, …})` to open a slide-over
// with the REAL detail of that entity (what the agent did). Pure data only: the
// item carries the already-typed payload the page already holds, so the drawer
// never fetches — it just renders depth. Project context (ticker/network/repo) is
// held once by the provider so click sites stay a one-liner. Pure types + the
// header mapping live in lib/inspect-item.ts (JSX-free, unit-tested) and are
// re-exported here for ergonomics.
// ─────────────────────────────────────────────────────────────────────────────

export { inspectKindMeta };
export type { InspectItem, InspectKindMeta };

interface InspectorContextValue {
  item: InspectItem | null;
  project: Project;
  inspect: (item: InspectItem) => void;
  close: () => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({
  project,
  children,
}: {
  project: Project;
  children: React.ReactNode;
}) {
  const [item, setItem] = useState<InspectItem | null>(null);
  const inspect = useCallback((next: InspectItem) => setItem(next), []);
  const close = useCallback(() => setItem(null), []);
  const value = useMemo(
    () => ({ item, project, inspect, close }),
    [item, project, inspect, close]
  );
  return (
    <InspectorContext.Provider value={value}>
      {children}
    </InspectorContext.Provider>
  );
}

/**
 * Access the inspector. Returns a no-op stub when used outside a provider so a
 * component can be rendered standalone (tests, the landing page) without
 * crashing — clicks simply do nothing there.
 */
export function useInspector(): Pick<
  InspectorContextValue,
  "item" | "inspect" | "close"
> {
  const ctx = useContext(InspectorContext);
  if (!ctx) {
    return { item: null, inspect: () => {}, close: () => {} };
  }
  return ctx;
}

/** Full context incl. the project — for the drawer, which needs ticker/network/repo. */
export function useInspectorContext(): InspectorContextValue | null {
  return useContext(InspectorContext);
}
