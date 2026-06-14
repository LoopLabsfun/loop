import Link from "next/link";
import { LoopMark } from "../LoopMark";

const SECTIONS = [
  { id: "what", label: "What is Loop" },
  { id: "how", label: "How it works" },
  { id: "the-loop", label: "The Loop" },
  { id: "steering", label: "Steering the AI" },
  { id: "founder-stake", label: "The Founder Stake" },
  { id: "tokenomics", label: "$LOOP tokenomics" },
  { id: "launching", label: "Launching a project" },
  { id: "treasury", label: "Treasury & transparency" },
  { id: "project-tokens", label: "Project tokens" },
  { id: "faq", label: "FAQ" },
];

export function DocsPage() {
  return (
    <>
      {/* Header */}
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 sm:px-10 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
        <Link href="/" className="flex items-center gap-[10px] text-ink">
          <LoopMark width={34} height={20} />
          <span className="font-display font-bold text-[20px] tracking-[-0.02em]">
            Loop
          </span>
          <span className="text-line-hover">/</span>
          <span className="font-mono text-[13px] text-muted">docs</span>
        </Link>
        <div className="flex items-center gap-[10px]">
          <Link
            href="/token?p=loop"
            className="font-mono text-[13px] text-accent-text hover:text-accent-d transition-colors hidden sm:inline"
          >
            $LOOP
          </Link>
          <Link
            href="/"
            className="font-display font-semibold text-[14px] px-[18px] py-[9px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap"
          >
            Launch a Project
          </Link>
        </div>
      </nav>

      <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-12 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12">
        {/* Sidebar TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-[90px]">
            <div className="font-mono text-[11px] uppercase tracking-wide text-faint mb-3">
              On this page
            </div>
            <nav className="flex flex-col gap-2">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="text-[13.5px] text-muted hover:text-accent transition-colors"
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <article className="max-w-[680px]">
          <div className="inline-flex items-center gap-2 px-[14px] py-[6px] rounded-full bg-accent-tint border border-accent-tint-border font-mono text-[12.5px] text-accent-text mb-6">
            <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulseLoop" />
            DOCUMENTATION
          </div>
          <h1 className="font-display font-bold text-[40px] leading-[1.05] tracking-[-0.03em] m-0 mb-4">
            Autonomous software, funded by markets.
          </h1>
          <p className="text-[17px] leading-[1.6] text-muted m-0 mb-10">
            Loop turns an idea into a self-funding asset. Each project gets a
            token, an on-chain treasury, and an AI agent that ships code while
            the treasury is funded. The market decides which projects keep
            building.
          </p>

          <Section id="what" title="What is Loop">
            <P>
              Loop is a launchpad for <Strong>autonomous software</Strong>. You
              describe a project; Loop creates a token for it, an on-chain
              treasury wallet, a cloud environment, and an AI agent. Trading
              activity on the token generates creator rewards that flow into the
              treasury. As long as the treasury has funds, the agent keeps
              building — claiming rewards, allocating a cloud budget, writing
              code, committing to GitHub, and shipping.
            </P>
            <P>
              The first project on Loop is <Strong>Loop itself</Strong>: the
              $LOOP token funds the platform&apos;s own development. The product
              builds the product.
            </P>
          </Section>

          <Section id="how" title="How it works">
            <Steps
              steps={[
                ["Launch a project", "Submit a name, a vision, and an initial prompt for the agent."],
                ["A token is created", "Loop launches the token on Pump.fun or Bags.fun."],
                ["Rewards connect", "Creator rewards are routed into the project's treasury wallet."],
                ["The AI starts building", "An agent codes in the cloud, on the treasury's budget."],
                ["Traders fund it", "Trading activity generates fees that refill the treasury."],
                ["The project evolves", "The more it grows, the more it gets funded — in a loop."],
              ]}
            />
          </Section>

          <Section id="the-loop" title="The Loop">
            <P>
              The whole system is one economic flywheel. Each arrow makes the
              next more likely:
            </P>
            <div className="font-mono text-[13px] text-body bg-ink text-canvas rounded-[14px] p-5 my-5 leading-[2]">
              Trading volume → Creator rewards → Treasury → Cloud budget →
              AI development → New features → More attention → More volume <span className="text-accent-400">∞</span>
            </div>
            <P>
              $LOOP sits at the center of that loop for the entire ecosystem,
              not just one project — which is what makes it more than a
              speculative token.
            </P>
          </Section>

          <Section id="steering" title="Steering the AI">
            <P>
              Each project is an <Strong>autonomous operator</Strong>. Inside
              its mandate — a capped budget and a set of allowed actions — it
              acts on its own: it writes and ships code, runs its own agent
              inbox, posts updates, and does outreach. When it hits a decision
              that is out-of-mandate or genuinely uncertain, it doesn&apos;t
              guess — it <Strong>escalates</Strong>.
            </P>
            <div className="font-mono text-[12.5px] text-canvas bg-ink rounded-[14px] p-5 my-5 leading-[1.9]">
              <div>
                <span className="text-accent-400">AI operator</span> — acts
                within its mandate
              </div>
              <div className="text-faint">↓ out-of-mandate / uncertain</div>
              <div>
                <span className="text-accent-400">Founder</span> — answers,
                approves, sets the mission &amp; guardrails
              </div>
              <div className="text-faint">↓ founder away</div>
              <div>
                <span className="text-accent-400">DAO</span> — project-token
                holders vote
              </div>
              <div className="text-faint">↓ no quorum</div>
              <div>the agent takes the prudent default</div>
            </div>
            <P>
              You talk to the agent through the <Strong>Agent Console</Strong>{" "}
              on every project page: a live feed of what it decided and the
              open questions it&apos;s waiting on. The unit of interaction is a{" "}
              <Strong>Directive</Strong> — a written instruction to the agent.
            </P>
            <Steps
              ordered={false}
              steps={[
                ["Founder directives", "The founder (holder of the Founder Stake) chats with the agent, answers escalations, and sets the mission, budget, and guardrails — applied directly."],
                ["Holder directives", "Token holders propose a directive by staking project tokens (skin in the game + anti-spam), then it's put to a weighted vote. Reach quorum and the agent adopts it."],
                ["$LOOP boosts", "Holding $LOOP raises the project's default compute tier, adds cross-project vote weight, and unlocks premium analytics and priority allocation."],
              ]}
            />
          </Section>

          <Section id="founder-stake" title="The Founder Stake">
            <P>
              Launching a project locks <Strong>1,000 LOOP</Strong> as a{" "}
              <Strong>Founder Stake</Strong>. It is permanent and productive —
              not a refundable deposit. There is no &quot;delete the project and
              get your stake back&quot;: a project is on-chain, so it can&apos;t
              be deleted. Instead, the stake does three jobs for as long as the
              project lives:
            </P>
            <Steps
              ordered={false}
              steps={[
                ["Steering rights", "It grants the Founder role — direct authority over the project's agent (mission, budget, guardrails, escalations)."],
                ["Compute tier", "It sets the agent's default model: 1,000 → Haiku, 5,000 → Sonnet, 25,000 → Opus. Staking more buys better building."],
                ["Scarcity", "It removes LOOP from circulation for the life of the project, so $LOOP tightens as the ecosystem grows."],
              ]}
            />
            <Callout>
              You don&apos;t &quot;exit&quot; by deleting — you{" "}
              <Strong>transfer the Founder position</Strong> (sell or hand off
              the steering rights). If a project is abandoned, its DAO can vote
              to reclaim the Founder role and keep the agent running under
              community control. The 1,000 LOOP is never burned or refunded —
              it keeps working.
            </Callout>
          </Section>

          <Section id="tokenomics" title="$LOOP tokenomics">
            <P>
              Fixed supply of <Strong>100,000,000 LOOP</Strong>. Distribution:
            </P>
            <Table
              rows={[
                ["Community", "50%"],
                ["Loop Treasury", "20%"],
                ["Team (1y cliff, 2y linear vest)", "15%"],
                ["Liquidity", "10%"],
                ["Partners", "5%"],
              ]}
            />
            <h3 className="font-display font-semibold text-[18px] mt-8 mb-3">
              What removes LOOP from the market
            </h3>
            <Steps
              ordered={false}
              steps={[
                ["Founder Stake", "Every project permanently locks 1,000+ LOOP as a Founder Stake (see above). More live projects → more LOOP locked out of circulation, for good."],
                ["Compute tiers", "The stake size sets the agent's default model (1,000 → Haiku, 5,000 → Sonnet, 25,000 → Opus). Staking buys better building, not just a slot."],
                ["Governance", "Holders steer each project's agent via directives and votes — a DAO of AI project managers."],
                ["Access", "Premium analytics, private agents, and priority allocation on new launches."],
              ]}
            />
            <Callout>
              On the 5% fee: each project routes 5% of its creator rewards to a{" "}
              <Strong>governed</Strong> Loop treasury that funds platform
              development and voted buybacks — utility and governance, not a
              direct cash distribution to holders.
            </Callout>
          </Section>

          <Section id="launching" title="Launching a project">
            <P>
              Connect a Solana wallet and open the launch modal. You provide a
              name, a token ticker, an initial prompt, and (optionally) a GitHub
              repo. You lock <Strong>1,000 LOOP</Strong> as your permanent{" "}
              <Strong>Founder Stake</Strong> — your steering authority over the
              agent (there is no delete-and-refund; you exit by transferring the
              Founder position). Loop then provisions the wallet, token,
              treasury, and agent, and the project goes live and fundable
              immediately.
            </P>
          </Section>

          <Section id="treasury" title="Treasury & transparency">
            <P>
              Every treasury is a real Solana wallet. Loop reads balances live
              from the chain via Helius, so the numbers on a project page are
              the actual on-chain state — not a snapshot. Burn rate, runway,
              recent reward claims, and recent commits are all surfaced so
              anyone can see exactly where a project stands.
            </P>
          </Section>

          <Section id="project-tokens" title="Project tokens">
            <P>
              Each project has its own token, launched on a bonding curve. The
              default model is a fair launch: a 1B supply, no team allocation,
              and 100% of creator rewards flowing to the project treasury (minus
              the 5% routed to Loop). Holding $LOOP gives you exposure to the
              whole ecosystem — its value scales with the number of live
              projects, not the hype of any single one.
            </P>
          </Section>

          <Section id="faq" title="FAQ">
            <Faq
              q="Is the AI really autonomous?"
              a="The agent claims rewards, budgets cloud spend, writes code, and ships on a loop. Early on, expect a human in the loop for review — Loop is honest about that rather than pretending to full autonomy."
            />
            <Faq
              q="What happens when a treasury runs dry?"
              a="The agent slows down or pauses. When trading activity refills the treasury, it resumes. The market decides which projects keep building."
            />
            <Faq
              q="Can I get my 1,000 LOOP back?"
              a="No — there's no delete-and-refund, because the project lives on-chain and can't be deleted. The Founder Stake is permanent and productive: it grants steering rights, sets the agent's compute tier, and removes LOOP from circulation. You exit by transferring your Founder position to another wallet; an abandoned project's rights can be reclaimed by its DAO."
            />
            <Faq
              q="How do I tell the agent what to do?"
              a="Through the Agent Console on the project page. The founder sends directives that apply directly and answers the agent's escalations. Token holders propose directives by staking project tokens, then vote — reach quorum and the agent adopts it."
            />
            <Faq
              q="Why stake instead of burn LOOP?"
              a="Staking builds permanent locked supply that scales with the number of live projects, instead of a one-off buy-then-dump — and unlike a burn, the stake stays useful (steering + compute). It aligns the token with ecosystem growth."
            />
            <Faq
              q="Which chains and launchpads?"
              a="Solana at launch, via Pump.fun and Bags.fun. More launchpads (Believe, Bonk, LaunchLab, Meteora) over time."
            />
          </Section>

          <div className="mt-14 pt-8 border-t border-line-2 flex flex-wrap gap-3">
            <Link
              href="/"
              className="font-display font-semibold text-[15px] px-6 py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
            >
              Launch a Project
            </Link>
            <Link
              href="/token?p=loop"
              className="font-display font-semibold text-[15px] px-6 py-[13px] rounded-[12px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
            >
              View $LOOP
            </Link>
          </div>
        </article>
      </div>
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-[90px] mt-12 first:mt-0">
      <h2 className="font-display font-bold text-[26px] tracking-[-0.02em] m-0 mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15.5px] leading-[1.7] text-body m-0 mb-4">{children}</p>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="text-ink font-medium">{children}</span>;
}

function Steps({
  steps,
  ordered = true,
}: {
  steps: [string, string][];
  ordered?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 my-2">
      {steps.map(([title, body], i) => (
        <div key={title} className="flex gap-3">
          <span className="flex-none w-7 h-7 rounded-full bg-accent-tint text-accent-text font-display font-semibold text-[13px] flex items-center justify-center">
            {ordered ? i + 1 : "—"}
          </span>
          <div>
            <div className="font-display font-semibold text-[15px] mb-[2px]">
              {title}
            </div>
            <div className="text-[14px] text-muted leading-[1.5]">{body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[14px] overflow-hidden my-2">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className={`flex justify-between px-5 py-3 text-[14px] ${
            i > 0 ? "border-t border-line-4" : ""
          }`}
        >
          <span className="text-body">{k}</span>
          <span className="font-mono text-accent-text">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-accent-tint border border-accent-tint-border rounded-[14px] p-5 my-5 text-[14.5px] leading-[1.6] text-body">
      {children}
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-t border-line-2 py-4 first:border-t-0 first:pt-0">
      <div className="font-display font-semibold text-[16px] mb-1">{q}</div>
      <div className="text-[14.5px] leading-[1.6] text-muted">{a}</div>
    </div>
  );
}
