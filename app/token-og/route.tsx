import { ImageResponse } from "next/og";
import { getProject } from "@/lib/queries";
import { getMarketStats } from "@/lib/market";
import { fmtPrice, compactUsd } from "@/lib/format";

// GET /token-og?p=<key> → 1200×630 PNG share card for a project's /token page,
// with its LIVE price + market cap baked in (DexScreener via getMarketStats) so a
// shared link renders the real number, not a generic site card. Referenced from
// the token route's generateMetadata. force-dynamic — the market read must not be
// cached. Node runtime (next/og under Node, same as the other image conventions).
export const dynamic = "force-dynamic";

const CANVAS = "#fcfcfd";
const INK = "#16131a";
const ACCENT = "#5b34d6";
const MUTED = "#6b6675";
const FAINT = "#9b95a4";
const POS = "#1a7f4b";
const NEG = "#c0392b";

function Ring({ color, marginLeft = 0 }: { color: string; marginLeft?: number }) {
  return (
    <div
      style={{
        width: 60,
        height: 60,
        borderRadius: 60,
        border: `16px solid ${color}`,
        marginLeft,
      }}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 24, color: FAINT }}>{label}</div>
      <div style={{ fontSize: 40, color: INK, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("p") || "loop";
  const project = (await getProject(key)) ?? (await getProject("loop"));
  const stats = project?.mint ? await getMarketStats(project.mint) : null;

  const name = project?.name ?? "Loop";
  const ticker = project?.ticker ?? "$LOOP";
  const official = project?.official ?? false;
  const change = stats?.priceChange24h ?? 0;
  const priceLabel = stats ? fmtPrice(stats.priceUsd) : "Not launched";

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
        {/* wordmark + ticker */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex" }}>
            <Ring color={INK} />
            <Ring color={INK} marginLeft={-24} />
          </div>
          <div style={{ marginLeft: 20, fontSize: 34, fontWeight: 700, color: INK }}>
            Loop
          </div>
          <div style={{ marginLeft: 16, fontSize: 28, color: FAINT }}>/</div>
          <div style={{ marginLeft: 16, fontSize: 30, color: ACCENT }}>{ticker}</div>
          {official && (
            <div
              style={{
                marginLeft: 20,
                fontSize: 20,
                color: "#ffffff",
                background: ACCENT,
                padding: "6px 14px",
                borderRadius: 8,
              }}
            >
              OFFICIAL
            </div>
          )}
        </div>

        {/* name + live price */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 56, fontWeight: 700, color: INK, letterSpacing: -1 }}>
            {name}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
            <div style={{ fontSize: 104, fontWeight: 700, color: INK, letterSpacing: -3 }}>
              {priceLabel}
            </div>
            {stats && (
              <div
                style={{
                  marginLeft: 24,
                  fontSize: 38,
                  color: change >= 0 ? POS : NEG,
                }}
              >
                {`${change >= 0 ? "+" : ""}${change.toFixed(2)}% · 24h`}
              </div>
            )}
          </div>
        </div>

        {/* live stats or tagline */}
        {stats ? (
          <div style={{ display: "flex", gap: 72 }}>
            <Stat label="Market Cap" value={compactUsd(stats.marketCap)} />
            <Stat label="Liquidity" value={compactUsd(stats.liquidityUsd)} />
            <Stat label="24h Volume" value={compactUsd(stats.volume24hUsd)} />
          </div>
        ) : (
          <div style={{ fontSize: 32, color: MUTED }}>
            An autonomous project funded by its market on Loop.
          </div>
        )}
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
