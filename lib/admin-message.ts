// Canonical message the FOUNDER signs to open an admin session. Mirrors the
// other loop.fun signed-message namespaces (launch / directive / chat / stake) —
// same `loop.fun <ns>\n…\nts:<ms>` shape with an anti-replay timestamp. The
// `loop.fun admin` namespace is INTERNAL signing scaffolding (not outward brand
// copy), so it stays `loop.fun` like the others — do not rebrand it.
//
// Pure + dependency-free so it's shared verbatim by the wallet (to sign) and the
// server (to verify), guaranteeing the two never drift.
export function buildAdminMessage(projectKey: string, ts: number): string {
  return `loop.fun admin\nproject:${projectKey}\nts:${ts}`;
}
