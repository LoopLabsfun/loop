import { notFound } from "next/navigation";
import { TokenPage } from "@/components/token/TokenPage";
import { getProject } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TokenRoute({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const project =
    (await getProject(searchParams.p ?? "loop")) ?? (await getProject("loop"));
  if (!project) notFound();
  return <TokenPage project={project} />;
}
