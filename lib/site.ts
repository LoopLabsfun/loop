// The canonical public origin of the app. Production is https://looplabs.fun
// (the custom domain attached to the deployment). Keeping this as the default —
// rather than the per-deploy *.vercel.app URL — means canonical links, Open
// Graph, the sitemap, robots, and the web manifest all resolve to ONE stable,
// branded origin even when NEXT_PUBLIC_SITE_URL isn't set. That consistency is
// what wallet/dapp reputation scanners (Phantom / Blowfish) and search crawlers
// read to recognise an established product. Override per environment (e.g. a
// preview deploy that should self-reference) via NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://looplabs.fun"
).replace(/\/+$/, "");
