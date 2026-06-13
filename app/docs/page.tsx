import type { Metadata } from "next";
import { DocsPage } from "@/components/docs/DocsPage";

export const metadata: Metadata = {
  title: "Docs — Loop",
  description:
    "How Loop works: autonomous software funded by markets. Tokenomics, launching a project, treasury transparency, and FAQ.",
};

export default function DocsRoute() {
  return <DocsPage />;
}
