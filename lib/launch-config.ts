// Public-launches gate.
//
// Phase A (LOOP-only): launches are CLOSED — visitors cannot create projects.
// Only the founder creates the LOOP project, via the service-role launch script
// (which bypasses RLS), so this gate never blocks LOOP itself. Reopen for the
// invite / public phases by setting NEXT_PUBLIC_LAUNCHES_OPEN=true.
//
// NEXT_PUBLIC_ so the same flag drives both the server action (authoritative
// gate) and the launch UI. Defense in depth: the projects RLS also forbids anon
// inserts while closed, so a direct REST call can't bypass this either.

export function launchesOpen(): boolean {
  return process.env.NEXT_PUBLIC_LAUNCHES_OPEN === "true";
}

export const LAUNCHES_CLOSED_MESSAGE =
  "Public launches are closed for now — Loop is in its LOOP-only phase. Creating new projects opens soon.";
