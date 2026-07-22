import { describe, expect, it } from "vitest";
import {
  chainsOf,
  deploymentOn,
  deploymentsOf,
  homeChain,
  homeDeployment,
  isLiveOn,
  isMultichain,
  projectOnChain,
  type ChainDeployment,
} from "./deployments";
import type { Project } from "../types";

const base = {
  key: "loop",
  name: "Loop",
  ticker: "$LOOP",
  description: "",
  official: true,
  launchpad: "Pump.fun",
  repo: "LoopLabsfun/loop",
  cover: "loop",
  price: 0,
  marketCap: "$0",
  liquidity: "$0",
  holders: "0",
  volume24h: "0 SOL",
  curve: 0,
  supply: "1B",
  burnPerDay: "0 SOL/day",
  runway: "—",
} as unknown as Project;

const solanaProject: Project = {
  ...base,
  chain: "solana",
  network: "mainnet",
  mint: "SolMint111",
  treasuryWallet: "SolTreasury111",
  agentWallet: "SolAgent111",
  treasurySol: 1.5,
  earnedSol: 0.25,
};

const hoodDeployment: ChainDeployment = {
  chain: "hood",
  mint: "0xtoken",
  treasuryWallet: "0xtreasury",
  agentWallet: "0xagent",
  treasuryNative: 0.4,
  earnedNative: 0.1,
  launchpad: null,
  network: "mainnet",
};

const dualChain: Project = { ...solanaProject, deployments: [hoodDeployment] };

describe("homeChain / homeDeployment", () => {
  it("defaults to solana for rows predating the chain column", () => {
    const { chain, ...noChain } = solanaProject;
    expect(homeChain(noChain as Project)).toBe("solana");
  });
  it("synthesizes the home deployment from the flat columns", () => {
    expect(homeDeployment(solanaProject)).toEqual({
      chain: "solana",
      mint: "SolMint111",
      treasuryWallet: "SolTreasury111",
      agentWallet: "SolAgent111",
      treasuryNative: 1.5,
      earnedNative: 0.25,
      launchpad: "Pump.fun",
      network: "mainnet",
    });
  });
});

describe("deploymentsOf", () => {
  it("a single-chain project has exactly its home deployment", () => {
    expect(deploymentsOf(solanaProject)).toHaveLength(1);
    expect(chainsOf(solanaProject)).toEqual(["solana"]);
    expect(isMultichain(solanaProject)).toBe(false);
  });
  it("lists home first, then the other chains", () => {
    expect(chainsOf(dualChain)).toEqual(["solana", "hood"]);
    expect(isMultichain(dualChain)).toBe(true);
  });
  it("never double-counts the home chain when it is also in project_chains", () => {
    // The backfill inserts a row for the home chain too — the flat columns win.
    const withHomeRow: Project = {
      ...dualChain,
      deployments: [
        { ...hoodDeployment, chain: "solana", mint: "STALE", treasuryNative: 99 },
        hoodDeployment,
      ],
    };
    expect(chainsOf(withHomeRow)).toEqual(["solana", "hood"]);
    expect(deploymentOn(withHomeRow, "solana")?.mint).toBe("SolMint111");
  });
});

describe("isLiveOn", () => {
  it("is false for a chain the project never launched on", () => {
    expect(isLiveOn(solanaProject, "hood")).toBe(false);
    expect(isLiveOn(dualChain, "hood")).toBe(true);
  });
});

describe("projectOnChain", () => {
  it("swaps the market side and leaves identity alone", () => {
    const onHood = projectOnChain(dualChain, "hood");
    // Market side follows the chain…
    expect(onHood.chain).toBe("hood");
    expect(onHood.mint).toBe("0xtoken");
    expect(onHood.treasuryWallet).toBe("0xtreasury");
    expect(onHood.agentWallet).toBe("0xagent");
    expect(onHood.treasurySol).toBe(0.4);
    expect(onHood.earnedSol).toBe(0.1);
    // …identity does NOT. Same project, same slug, same repo.
    expect(onHood.key).toBe("loop");
    expect(onHood.ticker).toBe("$LOOP");
    expect(onHood.repo).toBe("LoopLabsfun/loop");
    expect(onHood.official).toBe(true);
  });

  it("is identity for the home chain", () => {
    expect(projectOnChain(dualChain, "solana")).toBe(dualChain);
  });

  it("returns the project unchanged for a chain it isn't deployed on", () => {
    expect(projectOnChain(solanaProject, "hood")).toBe(solanaProject);
  });

  it("drops home-chain live reads so they can't be shown as the other chain's", () => {
    const live: Project = {
      ...dualChain,
      treasuryLive: true,
      treasuryTokenUi: 1234,
      treasuryHistory: [{ t: 1, sol: 2 }],
    };
    const onHood = projectOnChain(live, "hood");
    expect(onHood.treasuryLive).toBeUndefined();
    expect(onHood.treasuryTokenUi).toBeUndefined();
    expect(onHood.treasuryHistory).toBeUndefined();
  });

  it("keeps the home launchpad when the deployment doesn't name one", () => {
    expect(projectOnChain(dualChain, "hood").launchpad).toBe("Pump.fun");
    const viaPons: Project = {
      ...dualChain,
      deployments: [{ ...hoodDeployment, launchpad: "Pons" as never }],
    };
    expect(projectOnChain(viaPons, "hood").launchpad).toBe("Pons");
  });
});
