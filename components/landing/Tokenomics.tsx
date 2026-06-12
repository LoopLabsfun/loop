const ALLOCATION = [
  { label: "Community", pct: 50, color: "var(--accent)" },
  { label: "Loop Treasury", pct: 20, color: "var(--accent-text)" },
  { label: "Team", pct: 15, color: "var(--accent-300)" },
  { label: "Liquidity", pct: 10, color: "var(--accent-200)" },
  { label: "Partners", pct: 5, color: "#E8E5EB" },
];

export function Tokenomics() {
  return (
    <section id="loop-token" className="max-w-[1160px] mx-auto px-10 pt-10 pb-7">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="font-display font-bold text-[28px] tracking-[-0.02em] m-0">
          $LOOP Tokenomics
        </h2>
        <span className="font-mono text-[13px] text-faint">
          Supply · 100,000,000 LOOP
        </span>
      </div>

      <div className="bg-surface border border-line-2 rounded-[18px] p-7 mb-4">
        <div className="flex h-[14px] rounded-full overflow-hidden mb-4">
          {ALLOCATION.map((a) => (
            <div key={a.label} style={{ width: `${a.pct}%`, background: a.color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-3 text-[13px] text-body">
          {ALLOCATION.map((a) => (
            <span key={a.label} className="inline-flex items-center gap-[7px]">
              <span
                className="w-[9px] h-[9px] rounded-[3px]"
                style={{ background: a.color }}
              />
              {a.label} · {a.pct}%
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Mechanic label="MECHANIC 01" title="Stake 1,000 LOOP to launch">
          <p className="text-[13.5px] text-muted leading-[1.55] m-0 mb-4">
            Every project locks LOOP while it&apos;s active — refundable when you
            delete it. Stake more to unlock a stronger default agent.
          </p>
          <div className="flex flex-col gap-[6px] font-mono text-[12px] text-body bg-surface-2 rounded-[10px] p-3">
            {[
              ["1,000 LOOP", "Haiku"],
              ["5,000 LOOP", "Sonnet"],
              ["25,000 LOOP", "Opus"],
            ].map(([l, r]) => (
              <div key={l} className="flex justify-between">
                <span>{l}</span>
                <span className="text-accent-text">{r}</span>
              </div>
            ))}
          </div>
        </Mechanic>

        <Mechanic label="MECHANIC 02" title="5% of creator rewards">
          <p className="text-[13.5px] text-muted leading-[1.55] m-0 mb-4">
            Each project routes 5% of its creator rewards to the Loop treasury.
            $LOOP becomes an index on the whole ecosystem.
          </p>
          <div className="flex flex-col gap-[6px] font-mono text-[12px] text-body bg-surface-2 rounded-[10px] p-3">
            {[
              ["Project A · 10 SOL/day", "→ 0.5 SOL"],
              ["Project B · 50 SOL/day", "→ 2.5 SOL"],
              ["Project C · 100 SOL/day", "→ 5.0 SOL"],
            ].map(([l, r]) => (
              <div key={l} className="flex justify-between">
                <span>{l}</span>
                <span className="text-accent-text">{r}</span>
              </div>
            ))}
          </div>
        </Mechanic>

        <Mechanic label="HOLDING $LOOP" title="One token, every agent">
          <div className="flex flex-col gap-[9px] text-[13.5px] text-body">
            {[
              "Launch projects",
              "Vote on agent budgets & models",
              "Govern the treasury & buybacks",
              "Access premium analytics & agents",
              "Priority allocation on new projects",
            ].map((t) => (
              <div key={t} className="flex gap-[9px] items-baseline">
                <span className="text-accent">—</span>
                {t}
              </div>
            ))}
          </div>
        </Mechanic>
      </div>
    </section>
  );
}

function Mechanic({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line-2 rounded-[18px] p-[26px]">
      <div className="font-mono text-[11.5px] text-accent-text mb-[10px]">
        {label}
      </div>
      <h3 className="font-display font-semibold text-[18px] m-0 mb-[10px]">
        {title}
      </h3>
      {children}
    </div>
  );
}
