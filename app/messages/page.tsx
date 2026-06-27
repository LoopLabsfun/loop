import type { Metadata } from "next";
import { Suspense } from "react";
import { MessagesView } from "@/components/MessagesView";

// Private wallet-to-wallet DMs. All data loads client-side through the signed
// user session, so the route itself is a thin shell. force-dynamic + noindex.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Messages — Loop", robots: { index: false } };

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesView />
    </Suspense>
  );
}
