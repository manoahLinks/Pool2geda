// Fill the yield source so rounds have a prize to pay.
//
// A deployed source starts empty, and an empty source is the nastiest failure
// this protocol has. `checkPrize` gates on `FHE.ge(_reserve, prize)` and
// silently credits zero when the reserve is short — and because winning and
// losing are deliberately indistinguishable from outside, an insolvent pool
// presents to every user as "not this round", forever, with no signal anywhere.
// Nothing reverts. Nothing logs. It simply never pays.
//
// So this script verifies by balance delta rather than trusting the receipt:
// ERC-7984 transfers saturate instead of reverting, which means funding with
// more cUSD than you hold succeeds having moved nothing at all.
//
//   npx hardhat run scripts/fund-yield.ts --network sepolia
//
// Amount is overridable:  FUND=250 npx hardhat run scripts/fund-yield.ts --network sepolia

import { ethers, fhevm, deployments } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const ok = (m: string) => console.log(`    OK  ${m}`);
const info = (m: string) => console.log(`    ..  ${m}`);

/// cUSD to place in the source, in whole tokens. At the deployed rate of
/// 11,000 units/second a 15-minute round accrues ~9.9 cUSD, so 200 covers
/// roughly twenty full rounds.
const DEFAULT_FUND = 200n;
const DECIMALS = 6n;

async function main() {
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();

  const cusdD = await deployments.get("ConfidentialUSD");
  const srcD = await deployments.get("StreamingYieldSource");

  const cusd = await ethers.getContractAt("ConfidentialUSD", cusdD.address);
  const src = await ethers.getContractAt("StreamingYieldSource", srcD.address);

  const amount = (process.env.FUND ? BigInt(process.env.FUND) : DEFAULT_FUND) * 10n ** DECIMALS;

  console.log(`signer ${me}`);
  console.log(`source ${srcD.address}`);
  console.log(`fund   ${amount} (${amount / 10n ** DECIMALS} cUSD)\n`);

  async function myCusd(): Promise<bigint> {
    const h = await cusd.confidentialBalanceOf(me);
    if (h === ethers.ZeroHash) return 0n;
    return await fhevm.userDecryptEuint(FhevmType.euint64, h, cusdD.address, signer);
  }

  // --- claim until we hold enough ---------------------------------------
  //
  // No approve, no wrap: the token is confidential from birth, so funding is
  // just repeated faucet claims. The faucet is throttled, so a large target may
  // need several runs an hour apart.
  let held = await myCusd();
  while (held < amount) {
    const nextAt = await cusd.nextFaucetAt(me);
    if (nextAt > 0n) {
      throw new Error(
        `Hold ${held}, need ${amount}, but the faucet is on cooldown until ` +
          `${new Date(Number(nextAt) * 1000).toISOString()}. Re-run later, or ` +
          `lower the target with FUND=<whole tokens>.`
      );
    }
    info(`hold ${held} cUSD — claiming 1,000 more`);
    await (await cusd.faucet()).wait();
    held = await myCusd();
  }
  ok(`hold ${held} cUSD`);

  // --- let the source pull ----------------------------------------------
  if (!(await cusd.isOperator(me, srcD.address))) {
    info("granting the source operator rights on cUSD");
    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await (await cusd.setOperator(srcD.address, expiry)).wait();
    ok("operator granted");
  }

  // --- fund, and verify it actually moved -------------------------------
  const before = await myCusd();
  const enc = await fhevm.createEncryptedInput(srcD.address, me).add64(amount).encrypt();
  await (await src.fund(enc.handles[0], enc.inputProof)).wait();
  const after = await myCusd();
  const moved = before - after;

  if (moved === 0n) {
    throw new Error(
      `fund() moved ZERO. Requested ${amount} while holding ${before}. ` +
        `ERC-7984 saturates rather than reverting, so this looked like a success.`
    );
  }
  ok(`source funded with ${moved} (requested ${amount})`);

  const rate = await src.ratePerSecond();
  const max = await src.maxPerHarvest();
  console.log(
    `\nStreaming at ${rate} units/sec, capped at ${max} per harvest.` +
      `\nA 15-minute round accrues ~${(900n * rate) / 10n ** DECIMALS} cUSD.`
  );
  console.log(`Currently accrued: ${await src.accrued()}`);
}

main().catch((e) => {
  console.error("\nFUNDING FAILED\n", e);
  process.exitCode = 1;
});
