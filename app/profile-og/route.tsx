import { ImageResponse } from "next/og";
import { isSolanaAddress } from "@/lib/api-guards";
import { getProfileView, resolveUsername } from "@/lib/profile-data";
import { shortAddr, compactUsd } from "@/lib/format";

// GET /profile-og?w=<wallet|username> → 1200×630 PNG share card for a /u profile:
// avatar, name, @handle, top badges, and live social stats. Referenced from the
// profile route's generateMetadata so a shared profile link renders a real card.
// force-dynamic — follower/holding reads must not be cached. Same DA as token-og.
export const dynamic = "force-dynamic";

const CANVAS = "#fcfcfd";
const INK = "#16131a";
const ACCENT = "#5b34d6";
const TINT = "#eee9fb";
const FAINT = "#9b95a4";
const GOLD_BG = "#f7edcf";
const GOLD_FG = "#8a6d1f";

function Ring({ color, marginLeft = 0 }: { color: string; marginLeft?: number }) {
  return <div style={{ width: 50, height: 50, borderRadius: 50, border: `14px solid ${color}`, marginLeft }} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 24, color: FAINT }}>{label}</div>
      <div style={{ fontSize: 46, color: INK, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("w") || "";
  const wallet = isSolanaAddress(param) ? param : await resolveUsername(param);

  let name = "Loop profile";
  let handle: string | null = null;
  let avatar: string | null = null;
  let badges: { label: string; gold: boolean }[] = [];
  const stats: { label: string; value: string }[] = [];

  if (wallet) {
    const v = await getProfileView(wallet);
    name = v.profile.displayName || shortAddr(wallet);
    handle = v.profile.username;
    avatar = v.profile.avatarUrl;
    badges = v.badges.slice(0, 4).map((b) => ({ label: b.label, gold: b.tone === "gold" }));
    stats.push({ label: "followers", value: String(v.follow.followers) });
    if (v.builder && v.builder.shipped > 0) stats.push({ label: "shipped", value: String(v.builder.shipped) });
    if (v.portfolioUsd != null) stats.push({ label: "portfolio", value: compactUsd(v.portfolioUsd) });
    if (v.launched.length > 0) stats.push({ label: "launched", value: String(v.launched.length) });
  }

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: CANVAS, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, fontFamily: "sans-serif" }}>
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex" }}>
            <Ring color={INK} />
            <Ring color={INK} marginLeft={-20} />
          </div>
          <div style={{ marginLeft: 18, fontSize: 32, fontWeight: 700, color: INK }}>Loop</div>
          <div style={{ marginLeft: 14, fontSize: 26, color: FAINT }}>/ profile</div>
        </div>

        {/* identity */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} width={132} height={132} style={{ borderRadius: 32, objectFit: "cover", border: `2px solid ${TINT}` }} alt="" />
          ) : (
            <div style={{ width: 132, height: 132, borderRadius: 32, background: TINT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 700, color: ACCENT }}>
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 32 }}>
            <div style={{ fontSize: 60, fontWeight: 700, color: INK, letterSpacing: -1 }}>{name}</div>
            {handle && <div style={{ fontSize: 30, color: ACCENT, marginTop: 4 }}>@{handle}</div>}
            <div style={{ display: "flex", marginTop: 16 }}>
              {badges.map((b) => (
                <div key={b.label} style={{ fontSize: 22, padding: "6px 14px", borderRadius: 8, marginRight: 10, background: b.gold ? GOLD_BG : TINT, color: b.gold ? GOLD_FG : ACCENT }}>
                  {b.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* stats or tagline */}
        {stats.length > 0 ? (
          <div style={{ display: "flex", gap: 72 }}>
            {stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} />
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 30, color: FAINT }}>A builder on Loop — the autonomous software factory.</div>
        )}
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
