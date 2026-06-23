import { LoopMark } from "../LoopMark";

const CHAIN = [
  "Trading volume",
  "Creator rewards",
  "Treasury",
  "Cloud budget",
  "AI development",
  "New features",
  "More users",
  "More volume",
];

function Sequence() {
  return (
    <div className="flex items-center gap-[18px] flex-none pr-[18px] whitespace-nowrap">
      {CHAIN.map((label, i) => (
        <span key={label} className="flex items-center gap-[18px]">
          <span className="font-mono text-[13px] text-canvas">{label}</span>
          {i < CHAIN.length - 1 && (
            <span className="text-accent-400 text-[14px]">→</span>
          )}
        </span>
      ))}
      <LoopMark width={34} height={20} stroke="var(--accent-400)" className="ml-1" />
    </div>
  );
}

export function LoopMarquee() {
  return (
    <section className="max-w-[1160px] mx-auto px-10 py-7">
      <div className="bg-ink rounded-[18px] flex overflow-hidden py-[26px]">
        <div className="marquee-track animate-marquee">
          <Sequence />
          <Sequence />
        </div>
      </div>
    </section>
  );
}
