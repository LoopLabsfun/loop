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
  title: "Privacy Policy — Loop",
  description:
    "What data Loop collects, how it's used, who processes it, and your rights.",
};

const SECTIONS: LegalSectionRef[] = [
  { id: "who", label: "1. Who we are" },
  { id: "collect", label: "2. What we collect" },
  { id: "use", label: "3. How we use it" },
  { id: "processors", label: "4. Processors & sharing" },
  { id: "onchain", label: "5. On-chain data is public" },
  { id: "retention", label: "6. Retention" },
  { id: "rights", label: "7. Your rights" },
  { id: "security", label: "8. Security" },
  { id: "intl", label: "9. International transfers" },
  { id: "children", label: "10. Children" },
  { id: "changes", label: "11. Changes" },
];

export default function PrivacyPage() {
  return (
    <LegalLayout
      slug="privacy"
      title="Privacy Policy"
      intro="How Loop collects, uses, and shares data. Loop is a crypto-native product — most project activity happens on public blockchains, which are permanent and not controlled by us."
      sections={SECTIONS}
    >
      <LegalSection id="who" title="1. Who we are">
        <LP>
          The data controller is{" "}
          <ToComplete>registered legal entity name & address</ToComplete>. For
          privacy questions, contact <ToComplete>privacy@ — entity email</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="collect" title="2. What we collect">
        <LList
          items={[
            <><LStrong>Account / auth data</LStrong> via our provider Privy — depending on how you log in: Google, X/Twitter, GitHub, Telegram, email, and/or a Solana wallet address.</>,
            <><LStrong>Wallet & on-chain data</LStrong> — public addresses, balances, transactions, and tokens associated with your activity.</>,
            <><LStrong>Project data</LStrong> — what you submit when launching (name, prompt/mandate, guardrails, content policy, links) and agent-generated content (tasks, posts, emails, actions).</>,
            <><LStrong>Agent mailbox</LStrong> — messages sent to/from a project&apos;s <code>@agents.looplabs.fun</code> address.</>,
            <><LStrong>Usage & technical data</LStrong> — log data, device/browser info, and analytics about how you use the app.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="use" title="3. How we use it">
        <LList
          items={[
            <>Operate the platform: authentication, launching, running project agents, displaying activity.</>,
            <>Security, fraud and abuse prevention, and enforcing our terms.</>,
            <>Improving the product and understanding usage.</>,
            <>Legal compliance (including any future KYC/AML obligations — <ToComplete>KYC/AML program details</ToComplete>).</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="processors" title="4. Processors & sharing">
        <LP>
          We share data with third-party processors strictly to run the service.
          We do not sell your personal data. Current processors include:
        </LP>
        <LList
          items={[
            <><LStrong>Privy</LStrong> — authentication & embedded/server wallets.</>,
            <><LStrong>Supabase</LStrong> — database & storage.</>,
            <><LStrong>Vercel</LStrong> — hosting & deployment.</>,
            <><LStrong>Helius</LStrong> — Solana RPC / on-chain reads.</>,
            <><LStrong>Anthropic</LStrong> — the AI model that powers the agent.</>,
            <><LStrong>PumpPortal / pump.fun</LStrong> — token launch & creator-fee operations.</>,
            <><LStrong>E2B</LStrong> — sandboxed code execution.</>,
            <><LStrong>Resend</LStrong> (email), <LStrong>Telegram</LStrong> (build-update bot), and <LStrong>analytics</LStrong> — <ToComplete>confirm analytics vendor</ToComplete>.</>,
          ]}
        />
        <LP>
          We may disclose data if required by law or to protect the platform and
          its users. <ToComplete>list any other processors & their DPAs</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="onchain" title="5. On-chain data is public & permanent">
        <LP>
          Transactions, token holdings, treasury and agent-wallet activity, and
          governance votes are recorded on public blockchains. This data is{" "}
          <LStrong>permanent, public, and outside our control</LStrong> — we
          cannot edit or delete it. Anything an agent publishes (posts, emails it
          sends) may also be public.
        </LP>
      </LegalSection>

      <LegalSection id="retention" title="6. Retention">
        <LP>
          We keep personal data only as long as needed to run the service and
          meet legal obligations, then delete or anonymize it. On-chain data
          cannot be deleted. <ToComplete>specific retention periods</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="rights" title="7. Your rights">
        <LP>
          Depending on where you live (e.g. EEA/UK GDPR, California CCPA), you may
          have rights to access, correct, delete, or port your personal data, and
          to object to certain processing. To exercise them, contact us at the
          address above. <ToComplete>jurisdiction-specific rights & legal bases</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="security" title="8. Security">
        <LP>
          We use reasonable technical and organizational measures to protect data,
          but no system is perfectly secure. You are responsible for your wallet
          keys and account credentials.
        </LP>
      </LegalSection>

      <LegalSection id="intl" title="9. International transfers">
        <LP>
          Our processors may store and process data in countries other than
          yours. Where required, we rely on appropriate safeguards.{" "}
          <ToComplete>transfer mechanism (e.g. SCCs)</ToComplete>.
        </LP>
      </LegalSection>

      <LegalSection id="children" title="10. Children">
        <LP>
          Loop is not for anyone under 18, and we do not knowingly collect data
          from children.
        </LP>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes">
        <LP>
          We may update this policy; material changes will be posted here with a
          new &quot;last updated&quot; date.
        </LP>
      </LegalSection>
    </LegalLayout>
  );
}
