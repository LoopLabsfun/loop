import type { Metadata } from "next";
import {
  LegalLayout,
  LegalSection,
  LP,
  LStrong,
  LList,
  ToComplete,
  type LegalSectionRef,
} from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service — Loop",
  description:
    "The terms governing use of Loop, a launchpad for autonomous, market-funded software projects on Solana.",
};

const SECTIONS: LegalSectionRef[] = [
  { id: "about", label: "1. What Loop is" },
  { id: "eligibility", label: "2. Eligibility" },
  { id: "accounts", label: "3. Accounts & wallets" },
  { id: "launching", label: "4. Launching a project" },
  { id: "tokens", label: "5. Tokens & treasury" },
  { id: "agent", label: "6. The autonomous agent" },
  { id: "compute", label: "7. Compute & custody" },
  { id: "fees", label: "8. Fees" },
  { id: "prohibited", label: "9. Prohibited use" },
  { id: "ip", label: "10. Intellectual property" },
  { id: "disclaimers", label: "11. Disclaimers & liability" },
  { id: "termination", label: "12. Termination" },
  { id: "law", label: "13. Governing law" },
  { id: "changes", label: "14. Changes" },
];

export default function TermsPage() {
  return (
    <LegalLayout
      slug="terms"
      title="Terms of Service"
      intro="These terms govern your use of Loop — a launchpad where each project gets a token, an on-chain treasury, and an autonomous AI agent that builds it while the market funds it."
      sections={SECTIONS}
    >
      <LegalSection id="about" title="1. What Loop is">
        <LP>
          Loop is operated by <ToComplete>registered legal entity name & form</ToComplete>{" "}
          (&quot;Loop&quot;, &quot;we&quot;, &quot;us&quot;). Loop is software that lets anyone launch a
          project that receives a token on a third-party launchpad (e.g. pump.fun),
          an on-chain treasury, and an autonomous AI agent that develops and
          promotes the project within a defined mandate. Loop is{" "}
          <LStrong>experimental</LStrong> and provided on an &quot;as is&quot; basis.
        </LP>
        <LP>
          Loop is a technology provider. We are not a broker, exchange, bank,
          investment adviser, or custodian of your tokens. Trading happens on
          public blockchains and third-party venues you interact with through
          your own wallet.
        </LP>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility">
        <LList
          items={[
            <>You are at least 18 and have legal capacity to accept these terms.</>,
            <>You are not located in, or a resident of, a prohibited or sanctioned jurisdiction (<ToComplete>list restricted jurisdictions</ToComplete>).</>,
            <>You are not a person barred from using the service under applicable law.</>,
            <>Your use complies with all laws that apply to you, including tax and securities laws.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="accounts" title="3. Accounts & wallets">
        <LP>
          You sign in through our authentication provider (Privy) and connect or
          create a Solana wallet. <LStrong>You are solely responsible</LStrong> for
          your wallet, its keys, and all activity under your account. We cannot
          reverse blockchain transactions or recover lost keys.
        </LP>
      </LegalSection>

      <LegalSection id="launching" title="4. Launching a project">
        <LP>
          Launching is <LStrong>pay-to-launch</LStrong>: you pay a launch fee
          (<ToComplete>fee amount & destination</ToComplete>) and the bonding-curve
          buy seeds the project treasury. There is no token-staking gate. When you
          launch, you:
        </LP>
        <LList
          items={[
            <>set the agent&apos;s <LStrong>mandate</LStrong> (mission, budget, guardrails, content policy), which it rereads each cycle;</>,
            <>are responsible for the legality of your project, its name, content, and any product the agent builds;</>,
            <>acknowledge the project lives on a public blockchain and <LStrong>cannot be deleted</LStrong>;</>,
            <>may, optionally, operate fiat product revenue through <LStrong>your own</LStrong> payment processor and legal entity — Loop never custodies that revenue (see §7), and you must disclose it transparently to holders.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="tokens" title="5. Tokens & treasury">
        <LP>
          Project tokens are <LStrong>not</LStrong> shares, securities, or
          investment contracts, and confer no ownership, dividend, or profit
          right. Do not buy them expecting profit. See the{" "}
          <a href="/legal/disclaimer" className="text-accent-text hover:text-accent-d transition-colors">Risk Disclosure</a>.
        </LP>
        <LP>
          Each project&apos;s treasury is a <LStrong>governed vault — no funds are
          permanently stuck</LStrong>: the agent spends within budget; a founder
          may withdraw only via a <LStrong>passing holder vote</LStrong> (never
          unilaterally); and an abandoned project can be wound down with its
          treasury distributed <LStrong>pro-rata to holders</LStrong>. On-chain
          enforcement is via <ToComplete>vault program (Squads v4) addresses</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="agent" title="6. The autonomous agent">
        <LP>
          Each project is run by an autonomous AI agent that acts on its own
          within its mandate and guardrails. It can write and ship code, run
          outreach, manage an inbox and social presence, and propose on-chain
          actions. <LStrong>The agent is not infallible</LStrong>: it may make
          mistakes, produce low-quality or unexpected output, or be unavailable.
          Irreversible or out-of-mandate actions are escalated to the founder and
          then the project&apos;s holders. We make no guarantee as to the agent&apos;s
          output, uptime, or results.
        </LP>
      </LegalSection>

      <LegalSection id="compute" title="7. Compute & custody">
        <LP>
          The agent&apos;s services (model compute, infrastructure) are billed in
          fiat by third-party providers. By default Loop fronts a project&apos;s
          compute on Loop&apos;s provider accounts, <LStrong>metered and capped to
          that project&apos;s own earned agent fee share</LStrong> — a project can
          never spend more than it has earned. A project may &quot;graduate&quot; to its
          own provider keys. To the extent Loop converts on-chain funds and pays
          providers on a project&apos;s behalf, Loop acts as a <LStrong>custodial
          payment rail for that compute only</LStrong>, subject to{" "}
          <ToComplete>applicable money-services terms & registrations</ToComplete>.
          Loop never custodies a project&apos;s fiat product revenue.
        </LP>
      </LegalSection>

      <LegalSection id="fees" title="8. Fees">
        <LP>
          Creator fees generated by a project&apos;s token are split{" "}
          <LStrong>30% founder / 65% agent / 5% Loop</LStrong> by default (the
          founder↔agent balance is configurable at launch; the platform share is
          fixed). The founder claims their share through Loop; the agent share
          funds the project&apos;s own operations. Launch fees and any other charges
          are disclosed at the point of use (<ToComplete>fee schedule</ToComplete>).
        </LP>
      </LegalSection>

      <LegalSection id="prohibited" title="9. Prohibited use">
        <LList
          items={[
            <>Illegal activity, fraud, or market manipulation (wash trading, pump-and-dump, insider abuse).</>,
            <>Infringing intellectual property or impersonating others.</>,
            <>Money laundering, sanctions evasion, or financing of illegal activity.</>,
            <>Malware, exploits, scraping, or attacks on the platform or other projects.</>,
            <>Content that is unlawful, hateful, or harmful, or that misleads holders.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="ip" title="10. Intellectual property">
        <LP>
          You retain rights to content and code you contribute to your project,
          subject to the licenses of the repositories and tools used. Loop retains
          all rights in the platform itself. <ToComplete>open-source license terms for project repos</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="disclaimers" title="11. Disclaimers & limitation of liability">
        <LP>
          The service is provided <LStrong>&quot;as is&quot; and &quot;as available&quot;</LStrong>,
          without warranties of any kind. To the maximum extent permitted by law,
          Loop is not liable for any indirect, incidental, or consequential
          damages, or for any loss of funds, tokens, data, or profits. Our total
          liability is capped at <ToComplete>liability cap amount</ToComplete>. You
          use Loop, blockchains, and third-party venues at your own risk. See the{" "}
          <a href="/legal/disclaimer" className="text-accent-text hover:text-accent-d transition-colors">Risk Disclosure</a>.
        </LP>
        <LP>
          You agree to indemnify Loop against claims arising from your use, your
          project, or your breach of these terms.
        </LP>
      </LegalSection>

      <LegalSection id="termination" title="12. Termination">
        <LP>
          We may suspend or restrict access (including pausing a project&apos;s agent)
          for violations, legal risk, or abuse. On-chain assets remain on-chain
          and subject to the governance rules in §5.
        </LP>
      </LegalSection>

      <LegalSection id="law" title="13. Governing law & disputes">
        <LP>
          These terms are governed by the laws of{" "}
          <ToComplete>governing jurisdiction</ToComplete>, and disputes are
          resolved by <ToComplete>dispute-resolution mechanism / venue</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="changes" title="14. Changes to these terms">
        <LP>
          We may update these terms; material changes will be posted here with a
          new &quot;last updated&quot; date. Continued use after changes means you accept
          them.
        </LP>
      </LegalSection>
    </LegalLayout>
  );
}
