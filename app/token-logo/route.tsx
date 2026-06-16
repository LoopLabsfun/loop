import { ImageResponse } from "next/og";

// GET /token-logo → 512×512 PNG: the violet brand square with the white loop
// mark (two overlapping rings) — same identity as the favicon, at the size
// pump.fun / DexScreener want for a token image. The mainnet launch fetches
// this as the $LOOP logo (scripts/mainnet-launch-loop.ts).
//
// Node runtime (not edge): a custom route.tsx with next/og + `runtime = "edge"`
// trips Next 14's "Failed to collect page data" at build; next/og renders fine
// under Node here (same as the icon.tsx / opengraph-image.tsx conventions).
export const dynamic = "force-static";

function Ring({ marginLeft = 0 }: { marginLeft?: number }) {
  return (
    <div
      style={{
        width: 150,
        height: 150,
        borderRadius: 150,
        border: "44px solid #ffffff",
        marginLeft,
      }}
    />
  );
}

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#5b34d6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex" }}>
          <Ring />
          <Ring marginLeft={-66} />
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
