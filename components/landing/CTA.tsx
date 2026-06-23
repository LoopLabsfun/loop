import Link from "next/link";

export function CTA({ onLaunch }: { onLaunch: () => void }) {
  return (
    <section className="max-w-[1160px] mx-auto px-10 pt-10 pb-14">
      <div className="bg-accent-tint border border-accent-tint-border rounded-[20px] p-12 grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-10 items-center">
        <div>
          <h2 className="font-display font-bold text-[32px] tracking-[-0.02em] m-0 mb-[10px]">
            Ready to launch your autonomous project?
          </h2>
          <p className="text-[15px] text-muted leading-[1.55] m-0 mb-6 max-w-[440px]">
            Launch your idea. Let the market fund your vision. The agent does the
            rest.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onLaunch}
              className="font-display font-semibold text-[15px] px-6 py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
            >
              Launch a Project
            </button>
            <Link
              href="/docs"
              className="font-display font-semibold text-[15px] px-6 py-[13px] rounded-[12px] border border-accent-300 bg-surface text-ink hover:border-accent transition-colors"
            >
              Read the Docs
            </Link>
          </div>
        </div>
        <div className="bg-surface border border-accent-tint-border rounded-[16px] p-6">
          <div className="font-display font-semibold text-[16px] mb-2">
            Buy $LOOP
          </div>
          <p className="text-[13.5px] text-muted leading-[1.5] m-0 mb-[18px]">
            Support Loop, the core engine. Hold $LOOP for exposure to every agent
            on the platform.
          </p>
          <Link
            href="/token?p=loop"
            className="block w-full text-center font-display font-semibold text-[14px] py-3 rounded-[10px] bg-ink text-white hover:bg-ink-2 transition-colors"
          >
            Trade $LOOP →
          </Link>
        </div>
      </div>
    </section>
  );
}
