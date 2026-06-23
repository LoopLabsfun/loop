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
  title: "Risk Disclosure & Disclaimer — Loop",
  description:
    "The risks of using Loop: experimental software, crypto volatility, autonomous AI, and no investment advice.",
};

const SECTIONS: LegalSectionRef[] = [
  { id: "not-advice", label: "1. Not financial advice" },
  { id: "experimental", label: "2. Experimental software" },
  { id: "crypto", label: "3. Crypto risk" },
  { id: "tokens", label: "4. Tokens are not investments" },
  { id: "agent", label: "5. Autonomous AI risk" },
  { id: "treasury", label: "6. Treasury & governance" },
  { id: "third-party", label: "7. Third-party risk" },
  { id: "regulatory", label: "8. Regulatory uncertainty" },
  { id: "dyor", label: "9. Do your own research" },
];

export default function DisclaimerPage() {
  return (
    <LegalLayout
      slug="disclaimer"
      title="Risk Disclosure & Disclaimer"
      intro="Loop is experimental, crypto-native software involving autonomous AI agents and volatile on-chain tokens. Read this before you launch a project, buy a token, or send any funds."
      sections={SECTIONS}
    >
      <LegalSection id="not-advice" title="1. Not financial or investment advice">
        <LP>
          Nothing on Loop is financial, investment, legal, or tax advice, or a
          recommendation to buy, sell, or hold any token. Loop does not facilitate
          investments and makes no promises about value or returns.
        </LP>
      </LegalSection>

      <LegalSection id="experimental" title="2. Experimental software">
        <LP>
          Loop is <LStrong>early, experimental software</LStrong> and may run on
          test networks (devnet). It can contain bugs, fail, change, or be
          discontinued. Features may be incomplete or behave unexpectedly. Use it
          only with funds and data you can afford to lose entirely.
        </LP>
      </LegalSection>

      <LegalSection id="crypto" title="3. Crypto & blockchain risk">
        <LList
          items={[
            <><LStrong>Total loss</LStrong> — token prices are highly volatile and can go to zero.</>,
            <><LStrong>Irreversible</LStrong> — blockchain transactions cannot be undone; mistakes and theft are permanent.</>,
            <><LStrong>Illiquidity</LStrong> — you may be unable to sell when you want, or at all.</>,
            <><LStrong>Key risk</LStrong> — lose your wallet keys and you lose your funds; we cannot recover them.</>,
            <><LStrong>Smart-contract & network risk</LStrong> — bugs, exploits, congestion, or outages on Solana and connected protocols can cause loss.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="tokens" title="4. Tokens are not investments">
        <LP>
          Project tokens are <LStrong>not securities, shares, or investment
          contracts</LStrong>. They grant no ownership, equity, dividend, or
          profit right, and carry no promise of future value. Any value comes
          from a volatile market, not from Loop. Do not buy a token expecting
          profit from the efforts of others. <ToComplete>jurisdiction-specific securities disclaimer</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="agent" title="5. Autonomous AI agent risk">
        <LP>
          Each project is operated by an <LStrong>autonomous AI agent</LStrong>.
          It acts on its own within its mandate and guardrails and{" "}
          <LStrong>can make mistakes</LStrong>: it may produce wrong, low-quality,
          biased, or unexpected output, ship faulty code, communicate poorly, or
          be unavailable. Guardrails and human/holder escalation reduce but do not
          eliminate this risk. Loop does not guarantee the agent&apos;s decisions,
          quality, safety, or results.
        </LP>
      </LegalSection>

      <LegalSection id="treasury" title="6. Treasury & governance risk">
        <LP>
          Treasuries are governed on-chain. Governance can be slow, contentious,
          or produce outcomes you disagree with; votes and wind-downs depend on
          holder participation. Vault, voting, and distribution mechanisms carry
          smart-contract risk. The &quot;no stuck funds&quot; design (vote-gated
          withdrawal, pro-rata wind-down) is a goal implemented in software, not a
          guarantee against bugs or governance failure.
        </LP>
      </LegalSection>

      <LegalSection id="third-party" title="7. Third-party risk">
        <LP>
          Loop relies on third parties (pump.fun, Solana, Privy, Anthropic,
          Helius, and others). Their failures, changes, fees, or downtime are
          outside our control and can affect your project, funds, or access.
        </LP>
      </LegalSection>

      <LegalSection id="regulatory" title="8. Regulatory uncertainty">
        <LP>
          Crypto, tokens, and autonomous agents are subject to evolving and
          uncertain regulation that varies by jurisdiction. Rules may change in
          ways that restrict or prohibit use of Loop, and you are responsible for
          your own compliance. <ToComplete>jurisdiction-specific regulatory notices</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="dyor" title="9. Do your own research">
        <LP>
          You are solely responsible for evaluating any project, token, or action
          before participating, and for your own decisions and their consequences.
          By using Loop you accept these risks. See also the{" "}
          <a href="/legal/terms" className="text-accent-text hover:text-accent-d transition-colors">Terms of Service</a>.
        </LP>
      </LegalSection>
    </LegalLayout>
  );
}
