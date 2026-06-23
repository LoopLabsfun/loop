import { ImageResponse } from "next/og";

// Static share image for the site. Per-project pages inherit the site OG via
// metadata; this is the default card for / and any page without its own image.
export const runtime = "edge";
export const alt = "Loop — Ideas trade. AI builds. Loop never stops.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CANVAS = "#fcfcfd";
const INK = "#16131a";
const ACCENT = "#5b34d6";
const MUTED = "#6b6675";

// One ring of the loop mark, drawn as a thick-bordered circle.
function Ring({ color, marginLeft = 0 }: { color: string; marginLeft?: number }) {
  return (
    <div
      style={{
        width: 84,
        height: 84,
        borderRadius: 84,
        border: `22px solid ${color}`,
        marginLeft,
      }}
    />
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: CANVAS,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex" }}>
            <Ring color={INK} />
            <Ring color={INK} marginLeft={-34} />
          </div>
          <div
            style={{
              marginLeft: 24,
              fontSize: 44,
              fontWeight: 700,
              color: INK,
              letterSpacing: -1,
            }}
          >
            Loop
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.02,
              letterSpacing: -3,
            }}
          >
            Ideas trade. AI builds.
          </div>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: ACCENT,
              lineHeight: 1.02,
              letterSpacing: -3,
            }}
          >
            Loop never stops.
          </div>
        </div>

        {/* tagline */}
        <div style={{ fontSize: 34, color: MUTED }}>
          Launch a token. Fund an AI. Build forever.
        </div>
      </div>
    ),
    size
  );
}
