import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

/// Epoch length for the public demo. Short enough that a judge can run a full
/// deposit -> draw -> check -> claim cycle in one sitting, long enough that the
/// time-weighted balance still means something. Note the claim window is one
/// epoch: a prize won in epoch N must be checked during epoch N+1.
const EPOCH_DURATION = 15 * 60; // 15 minutes

/// Public prize ceiling per draw: 5 cUSD (6 decimals).
///
/// Deliberately well BELOW what a full round accrues (~9.9 cUSD). The reserve
/// must comfortably cover the ceiling or `checkPrize` pays out less than
/// advertised — and an earlier version of these constants had a 9.9/round
/// stream chasing a 10 ceiling, which could never be solvent even on a perfect
/// round. Headroom is not a luxury here; it is the difference between a prize
/// and a rounding error.
const PRIZE_PER_DRAW = 5_000_000n;

/// Simulated yield, released against the clock.
///
/// A full 15-minute round accrues 900s x 11,000 = 9.9 cUSD, roughly double the
/// prize ceiling, so the reserve builds a buffer instead of running to empty.
/// The figure still moves between rounds the way real prize savings do, without
/// claiming a source of return that does not exist on a test network. See
/// StreamingYieldSource for the full disclaimer.
const YIELD_PER_SECOND = 11_000n;
const MAX_PER_HARVEST = 20_000_000n; // 20 cUSD — one long silence cannot drain it

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log(`Deploying to ${network.name} from ${deployer}`);

  // Confidential from birth — no ERC-20 underneath, so no per-user amount is
  // ever published. The ERC-20 wrapper path lives in contracts/alt and stays
  // deployed from an earlier run; the pool does not depend on it.
  const confidentialUsd = await deploy("ConfidentialUSD", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 2,
  });

  const prizePool = await deploy("ConfidentialPrizePool", {
    from: deployer,
    args: [confidentialUsd.address, EPOCH_DURATION, PRIZE_PER_DRAW, deployer],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 2,
  });

  // The prize source. Deployed after the pool because it is bound to it —
  // `harvest` accepts calls from that address alone.
  const yieldSource = await deploy("StreamingYieldSource", {
    from: deployer,
    args: [
      confidentialUsd.address,
      prizePool.address,
      YIELD_PER_SECOND,
      MAX_PER_HARVEST,
      deployer,
    ],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 2,
  });

  // Wire it up. Until this lands the pool simply has no source and the reserve
  // is filled by `fundPrize` alone, which is a valid configuration.
  const pool = await ethers.getContractAt("ConfidentialPrizePool", prizePool.address);
  const current = await pool.yieldSource();
  if (current.toLowerCase() !== yieldSource.address.toLowerCase()) {
    log(`Setting yield source -> ${yieldSource.address}`);
    await (await pool.setYieldSource(yieldSource.address)).wait();
  }

  log("");
  log(`ConfidentialUSD       ${confidentialUsd.address}`);
  log(`ConfidentialPrizePool ${prizePool.address}`);
  log(`StreamingYieldSource  ${yieldSource.address}`);
  log("");
  log("NOTE: the yield source ships empty. Fund it before the first draw or");
  log("every checkPrize correctly credits zero — see scripts/fund-yield.ts.");

  // Sanity check: confirm the pool resolved a real Zama coprocessor for this
  // chain. A protocol id of 0 means the chain is unsupported by the config base
  // and every FHE call would revert at runtime.
  if (network.name !== "hardhat") {
    const protocolId = await pool.confidentialProtocolId();
    log(`confidentialProtocolId ${protocolId} (10001 = Zama testnet)`);
    if (protocolId === 0n) {
      throw new Error(
        "Pool resolved protocol id 0 — this chain is not supported by ZamaEthereumConfig."
      );
    }
  }

  // Write addresses through to the frontend so the two cannot drift.
  //
  // Only for real networks. An in-process `hardhat` run is a throwaway chain
  // that disappears when the process exits, so writing its addresses here
  // silently repoints the frontend at contracts that no longer exist — a
  // `hardhat deploy` used as a dry run would quietly break the working config.
  if (network.name === "hardhat") {
    log("\nLocal run — leaving web/.env untouched.");
    return;
  }

  const envPath = resolve(__dirname, "../../web/.env");
  // The block the pool landed in. The frontend scans `Deposited` logs from
  // here: every Sepolia RPC caps eth_getLogs by block range (the default
  // provider at 1,000 blocks), so a scan from genesis is rejected outright and
  // the register comes back empty on a chain with real history.
  const deployBlock =
    prizePool.receipt?.blockNumber ??
    (await ethers.provider.getBlockNumber());

  const next: Record<string, string> = {
    VITE_CONFIDENTIAL_USD_ADDRESS: confidentialUsd.address,
    VITE_PRIZE_POOL_ADDRESS: prizePool.address,
    VITE_DEPLOY_BLOCK: String(deployBlock),
  };

  // Preserve any keys the user set by hand (RPC URL, WalletConnect id).
  const existing: Record<string, string> = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in next)) existing[m[1]] = m[2];
    }
  }

  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(
    envPath,
    Object.entries({ ...existing, ...next })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
  log(`\nWrote ${envPath}`);
};

func.tags = ["all"];
export default func;
