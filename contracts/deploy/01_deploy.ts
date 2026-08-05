import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

/// Epoch length for the public demo. Short enough that a judge can run a full
/// deposit -> draw -> check -> claim cycle in one sitting, long enough that the
/// time-weighted balance still means something. Note the claim window is one
/// epoch: a prize won in epoch N must be checked during epoch N+1.
const EPOCH_DURATION = 15 * 60; // 15 minutes

/// Public prize per draw: 10 cUSD (6 decimals).
const PRIZE_PER_DRAW = 10_000_000n;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log(`Deploying to ${network.name} from ${deployer}`);

  const testUsd = await deploy("TestUSD", {
    from: deployer,
    args: [deployer],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 2,
  });

  const confidentialUsd = await deploy("ConfidentialUSD", {
    from: deployer,
    args: [testUsd.address],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 2,
  });

  const prizePool = await deploy("ConfidentialPrizePool", {
    from: deployer,
    args: [confidentialUsd.address, EPOCH_DURATION, PRIZE_PER_DRAW, deployer],
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 2,
  });

  log("");
  log(`TestUSD               ${testUsd.address}`);
  log(`ConfidentialUSD       ${confidentialUsd.address}`);
  log(`ConfidentialPrizePool ${prizePool.address}`);

  // Sanity check: confirm the pool resolved a real Zama coprocessor for this
  // chain. A protocol id of 0 means the chain is unsupported by the config base
  // and every FHE call would revert at runtime.
  if (network.name !== "hardhat") {
    const pool = await ethers.getContractAt("ConfidentialPrizePool", prizePool.address);
    const protocolId = await pool.confidentialProtocolId();
    log(`confidentialProtocolId ${protocolId} (10001 = Zama testnet)`);
    if (protocolId === 0n) {
      throw new Error(
        "Pool resolved protocol id 0 — this chain is not supported by ZamaEthereumConfig."
      );
    }
  }

  // Write addresses through to the frontend so the two cannot drift.
  const envPath = resolve(__dirname, "../../web/.env");
  const next: Record<string, string> = {
    VITE_TEST_USD_ADDRESS: testUsd.address,
    VITE_CONFIDENTIAL_USD_ADDRESS: confidentialUsd.address,
    VITE_PRIZE_POOL_ADDRESS: prizePool.address,
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
