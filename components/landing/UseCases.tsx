// Illustrative ideas — the kind of project Loop is built for — NOT live tokens.
// Tagged "example" (not a $ticker) so the page never implies a project exists
// before it has actually been launched.
const CASES = [
  {
    title: "Recreate GTA before GTA 6",
    body: "An open-source GTA-inspired world, shipped before the official release.",
  },
  {
    title: "Autonomous Video Generator",
    body: "An open-source rival to Runway or Veo, funded by its own token.",
  },
  {
    title: "Autonomous Prediction Market",
    body: "A Polymarket alternative that pays for its own development.",
  },
  {
    title: "Open Source Cursor",
    body: "An autonomous AI IDE, funded directly by its community.",
  },
];

export function UseCases() {
  return (
    <section id="loop-cases" className="max-w-[1160px] mx-auto px-10 pt-10 pb-7">
      <h2 className="font-display font-bold text-[28px] tracking-[-0.02em] m-0 mb-[6px]">
        What gets built on Loop
      </h2>
      <p className="text-[15px] text-muted m-0 mb-5">
        Ideas too ambitious for a seed round. Just right for a market. These are
        illustrative examples — not live tokens.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CASES.map((c) => (
          <div
            key={c.title}
            className="bg-surface border border-line-2 rounded-[16px] p-6 flex justify-between gap-4 items-start hover:border-accent-300 transition-colors"
          >
            <div>
              <h3 className="font-display font-semibold text-[17px] m-0 mb-[6px]">
                {c.title}
              </h3>
              <p className="text-[13.5px] text-muted leading-[1.5] m-0">{c.body}</p>
            </div>
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-faint bg-surface-2 border border-line-4 px-[9px] py-1 rounded-[6px] flex-none">
              example
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
