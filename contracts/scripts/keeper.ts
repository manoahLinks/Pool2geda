// Keeper — keeps the pool's rounds turning without anyone watching.
//
// Every round transition is permissionless, which is a trust property worth
// having: nobody can withhold a draw. But permissionless is not the same as
// automatic, and an unattended pool simply stops. A previous deployment sat
// idle for 15.7 hours and fell 62 periods behind; a judge arriving at that pool
// finds a dead app.
//
// Two jobs, both idempotent, both safe to lose a run of:
//
//   1. closeEpoch()  once the clock has run out
//   2. publicDecrypt(total, R) -> awardDraw()  for the round that just closed
//
// checkPrize is deliberately NOT done here. It is per-user, it credits an
// encrypted prize to whoever calls it, and doing it on someone's behalf would
// both cost the keeper gas per participant and take away the one action in the
// product that is meaningfully the user's own.
//
//   npx hardhat run scripts/keeper.ts --network sepolia
//
// Loops for KEEPER_MINUTES (default 13) polling every KEEPER_POLL_SECONDS
// (default 45), because GitHub's scheduler is only approximately punctual —
// see .github/workflows/keeper.yml.

import { ethers, fhevm, deployments } from "hardhat";

const MINUTES = Number(process.env.KEEPER_MINUTES ?? 13);
const POLL_MS = Number(process.env.KEEPER_POLL_SECONDS ?? 45) * 1000;

/// Below this, the keeper cannot pay for the transactions it exists to send.
/// Warned about loudly rather than failed on, so the run still does what it can.
const LOW_BALANCE = ethers.parseEther("0.01");

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`[${ts()}] ${m}`);

/// Fail on the real problem, not twelve frames into an RPC call.
///
/// A missing secret used to surface as `HH110: invalid project id` from Infura,
/// because an empty ALCHEMY_API_KEY_SEPOLIA falls through to a placeholder URL.
/// That is a long way from "you did not add the secret", and CI logs are the
/// worst possible place to debug indirection.
function preflight() {
  if (!process.env.CI) return; // locally, credentials come from `hardhat vars`
  const missing: string[] = [];
  if (!process.env.PRIVATE_KEY) missing.push("KEEPER_PRIVATE_KEY");
  if (!process.env.ALCHEMY_API_KEY_SEPOLIA) missing.push("SEPOLIA_RPC_URL");
  if (missing.length === 0) return;
  throw new Error(
    `Missing repository secret(s): ${missing.join(", ")}.\n` +
      `Add them under Settings -> Secrets and variables -> Actions.\n` +
      `  KEEPER_PRIVATE_KEY  a funded Sepolia key, bare hex or 0x-prefixed\n` +
      `  SEPOLIA_RPC_URL     a full https RPC URL, or a bare Alchemy key\n` +
      `A secret that exists prints as *** in the env block above; a blank there ` +
      `means it was never created.`
  );
}

async function main() {
  preflight();
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const poolD = await deployments.get("ConfidentialPrizePool");
  const pool = await ethers.getContractAt("ConfidentialPrizePool", poolD.address);

  const balance = await ethers.provider.getBalance(me);
  log(`keeper ${me} | ${ethers.formatEther(balance)} ETH | pool ${poolD.address}`);
  if (balance < LOW_BALANCE) {
    log(`WARNING: balance below ${ethers.formatEther(LOW_BALANCE)} ETH — top up the keeper`);
  }

  const until = Date.now() + MINUTES * 60_000;
  let closed = 0;
  let settled = 0;

  while (Date.now() < until) {
    try {
      closed += await maybeClose(pool);
      settled += await maybeSettle(pool);
    } catch (e) {
      // A single bad tick must never end the run — the next one is 45 seconds
      // away and the chain will have moved on.
      log(`tick failed: ${(e as Error).message.split("\n")[0].slice(0, 140)}`);
    }
    const left = until - Date.now();
    if (left <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, left)));
  }

  log(`done — closed ${closed}, settled ${settled}`);
}

/// Close the round if its clock has run out. Returns 1 if it did.
async function maybeClose(pool: Awaited<ReturnType<typeof ethers.getContractAt>>) {
  const endsAt: bigint = await (pool as any).epochEndsAt();
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  if (now < endsAt) return 0;

  const epoch: bigint = await (pool as any).epoch();
  log(`epoch ${epoch} expired ${now - endsAt}s ago — closing`);
  try {
    const rc = await (await (pool as any).closeEpoch()).wait();
    log(`  closed, gas ${rc?.gasUsed}, now in epoch ${await (pool as any).epoch()}`);
    return 1;
  } catch (e) {
    // Someone else got there first, which is the system working as intended.
    const m = (e as Error).message;
    if (m.includes("EpochNotOver")) return 0;
    throw e;
  }
}

/// Decrypt the closed round's two public figures and prove them back on-chain.
/// Returns 1 if a draw was settled.
async function maybeSettle(pool: Awaited<ReturnType<typeof ethers.getContractAt>>) {
  const epoch: bigint = await (pool as any).epoch();
  if (epoch === 0n) return 0;
  const last = epoch - 1n;

  const totalHandle: string = await (pool as any).pendingTotalHandle(last);
  // A round crossed as dead time produces no draw at all — nothing to settle,
  // and awardDraw would revert DrawNotAwarded.
  if (totalHandle === ethers.ZeroHash) return 0;

  const draw = await (pool as any).draws(last);
  if (draw.awarded) return 0;

  const randHandle: string = await (pool as any).pendingRandomHandle(last);
  log(`round ${last} closed but not settled — decrypting`);

  // The relayer answers "not ready" for a few seconds after a close while the
  // ciphertext propagates to the gateway. Handle order is load-bearing: the
  // proof is bound to it and must match the contract's own array.
  const instance = await fhevm.createInstance();
  let dec: {
    abiEncodedClearValues: string;
    decryptionProof: string;
  } | null = null;

  for (let i = 0; i < 10; i++) {
    try {
      dec = (await instance.publicDecrypt([totalHandle, randHandle])) as typeof dec;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!dec) {
    log("  relayer never became ready — will retry next tick");
    return 0;
  }

  try {
    const rc = await (
      await (pool as any).awardDraw(last, dec.abiEncodedClearValues, dec.decryptionProof)
    ).wait();
    log(`  settled round ${last}, gas ${rc?.gasUsed}`);
    return 1;
  } catch (e) {
    const m = (e as Error).message;
    // Both are benign races: someone else settled it, or the round genuinely
    // had no deposits and cannot be drawn.
    if (m.includes("DrawAlreadyAwarded")) return 0;
    if (m.includes("NothingToDraw")) {
      log(`  round ${last} had no deposits — nothing to draw`);
      return 0;
    }
    throw e;
  }
}

main().catch((e) => {
  console.error("KEEPER FAILED\n", e);
  process.exitCode = 1;
});
