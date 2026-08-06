// SPIKE 1 — validate the client SDK against the LIVE Sepolia relayer.
//
// Everything in the test suite runs against the local FHE mock, which never
// touches the relayer. This exercises the three round trips the dApp actually
// depends on, in order of increasing risk:
//
//   1. encrypt()            -> contract FHE.fromExternal   (deposit path)
//   2. userDecrypt()        -> read your own balance       (EIP-712 permit)
//   3. publicDecrypt() x2   -> checkSignatures             (the draw)
//
// Step 3 is the one to watch: handle ordering, proof binding, and gateway
// propagation timing all have to line up, and it is the path the whole draw
// depends on.
//
//   npx hardhat run scripts/spike-relayer.ts --network sepolia
//
// NOTE: this runs under hardhat, so it uses the SAME relayer SDK the hardhat
// plugin bundles. It proves the relayer round trips work end to end against
// live contracts. Whether `@zama-fhe/sdk` (the browser package) drives the
// same flow is verified separately in the web app.

import { ethers, fhevm, deployments } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`);
const ok = (msg: string) => console.log(`    OK  ${msg}`);
const info = (msg: string) => console.log(`    ..  ${msg}`);

async function main() {
  // The plugin auto-initialises inside `hardhat test`, but not under
  // `hardhat run` — without this, createEncryptedInput throws
  // "The Hardhat Fhevm plugin is not initialized."
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log(`signer ${me}`);

  const usdD = await deployments.get("TestUSD");
  const cusdD = await deployments.get("ConfidentialUSD");
  const poolD = await deployments.get("ConfidentialPrizePool");

  const usd = await ethers.getContractAt("TestUSD", usdD.address);
  const cusd = await ethers.getContractAt("ConfidentialUSD", cusdD.address);
  const pool = await ethers.getContractAt("ConfidentialPrizePool", poolD.address);

  console.log(`pool   ${poolD.address}`);

  const DEPOSIT = 5_000_000n; // 5 cUSD into the pool
  const FUND = 20_000_000n; // 20 cUSD into the prize reserve
  const NEEDED = DEPOSIT + FUND; // must hold this much cUSD before starting

  // ---------------------------------------------------------------------
  step(0, "Fund and wrap (public — this is the confidentiality boundary)");

  const bal = await usd.balanceOf(me);
  if (bal < NEEDED) {
    info(`tUSD balance ${bal}, claiming from faucet`);
    await (await usd.faucet()).wait();
    ok(`faucet claimed, balance now ${await usd.balanceOf(me)}`);
  } else {
    ok(`tUSD balance ${bal}, no faucet needed`);
  }

  // Top up to NEEDED rather than wrapping only when the balance is zero — the
  // script must be idempotent across re-runs, and a partial balance left over
  // from a previous run would otherwise cause a silent saturating transfer
  // later.
  const held = await myCusd();
  if (held < NEEDED) {
    const shortfall = NEEDED - held;
    info(`holds ${held} cUSD, wrapping ${shortfall} more`);
    await (await usd.approve(cusdD.address, shortfall)).wait();
    await (await cusd.wrap(me, shortfall)).wait();
    ok(`wrapped, now holds ${await myCusd()} cUSD`);
  } else {
    ok(`already holds ${held} cUSD`);
  }

  if (!(await cusd.isOperator(me, poolD.address))) {
    info("granting pool operator rights on cUSD");
    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await (await cusd.setOperator(poolD.address, expiry)).wait();
    ok("operator granted");
  } else {
    ok("pool already an operator");
  }

  // ---------------------------------------------------------------------
  // Roll past any already-expired epoch first. Depositing into an epoch whose
  // timer has elapsed correctly contributes nothing to it, so the draw would
  // settle empty.
  {
    const endsAt = await pool.epochEndsAt();
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    if (now >= endsAt) {
      info(`epoch ${await pool.epoch()} already expired — rolling over first`);
      await (await pool.closeEpoch()).wait();
      ok(`now in epoch ${await pool.epoch()}`);
    }
  }

  // ---------------------------------------------------------------------
  step(1, "encrypt() -> FHE.fromExternal (deposit)");

  const t1 = Date.now();
  const enc = await fhevm
    .createEncryptedInput(poolD.address, me)
    .add64(DEPOSIT)
    .encrypt();
  ok(`encrypted input + ZK proof in ${Date.now() - t1}ms`);
  info(`handle ${enc.handles[0]}`);

  const depTx = await pool.deposit(enc.handles[0], enc.inputProof);
  const depRc = await depTx.wait();
  ok(`deposit mined, gas ${depRc?.gasUsed} (tx ${depTx.hash})`);

  // ---------------------------------------------------------------------
  step(2, "userDecrypt() — read my own encrypted balance");

  const sharesHandle = await pool.sharesOf(me);
  info(`shares handle ${sharesHandle}`);

  const t2 = Date.now();
  const shares = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    sharesHandle,
    poolD.address,
    signer
  );
  ok(`decrypted in ${Date.now() - t2}ms -> ${shares}`);

  if (shares < DEPOSIT) {
    throw new Error(
      `Expected at least ${DEPOSIT}, got ${shares}. If this is 0, the transfer ` +
        `saturated — check the operator grant and cUSD balance.`
    );
  }

  // ---------------------------------------------------------------------
  step(3, "publicDecrypt() x2 -> checkSignatures (the draw)");

  // Fund the reserve so a win is actually payable, otherwise checkPrize
  // correctly credits zero and step 4 proves nothing.
  //
  // Must be within the wallet's remaining cUSD (WRAP - DEPOSIT). ERC7984
  // transfers SATURATE rather than revert, so over-funding silently moves zero
  // and leaves the reserve empty — the transaction still succeeds. Verified by
  // balance delta below rather than trusted.
  await fundReserve(20_000_000n);

  async function fundReserve(amount: bigint) {
    const before = await myCusd();
    const fundEnc = await fhevm
      .createEncryptedInput(poolD.address, me)
      .add64(amount)
      .encrypt();
    await (await pool.fundPrize(fundEnc.handles[0], fundEnc.inputProof)).wait();
    const after = await myCusd();
    const moved = before - after;
    if (moved === 0n) {
      throw new Error(
        `fundPrize moved ZERO. Requested ${amount} but wallet held ${before}. ` +
          `ERC7984 saturates instead of reverting, so this looked like a success.`
      );
    }
    ok(`prize reserve funded with ${moved} (requested ${amount})`);
  }

  async function myCusd(): Promise<bigint> {
    const h = await cusd.confidentialBalanceOf(me);
    if (h === ethers.ZeroHash) return 0n;
    return await fhevm.userDecryptEuint(FhevmType.euint64, h, cusdD.address, signer);
  }

  const epoch = await pool.epoch();
  const endsAt = await pool.epochEndsAt();
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

  if (now < endsAt) {
    const wait = Number(endsAt - now) + 5;
    info(`epoch ${epoch} closes in ${wait}s — waiting (real time, no fast-forward)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }

  info("closeEpoch()");
  const closeRc = await (await pool.closeEpoch()).wait();
  ok(`epoch closed, gas ${closeRc?.gasUsed}`);

  const totalHandle = await pool.pendingTotalHandle(epoch);
  const randHandle = await pool.pendingRandomHandle(epoch);
  info(`total handle ${totalHandle}`);
  info(`rand  handle ${randHandle}`);

  // The relayer needs the ciphertext to propagate to the gateway first, so
  // this is retried. Order is load-bearing — the proof is bound to it.
  const instance = await fhevm.createInstance();
  let dec: {
    clearValues: Record<string, bigint | boolean>;
    abiEncodedClearValues: string;
    decryptionProof: string;
  } | null = null;

  const t3 = Date.now();
  for (let i = 0; i < 15; i++) {
    try {
      dec = (await instance.publicDecrypt([totalHandle, randHandle])) as typeof dec;
      break;
    } catch (e) {
      info(`attempt ${i + 1} not ready (${(e as Error).message.slice(0, 70)})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!dec) throw new Error("public decryption never became ready");
  ok(`public decryption ready after ${Date.now() - t3}ms`);
  info(`total  = ${dec.clearValues[totalHandle]}`);
  info(`rand   = ${dec.clearValues[randHandle]}`);
  info(`proof  = ${dec.decryptionProof.slice(0, 24)}... (${dec.decryptionProof.length} chars)`);

  const awardRc = await (
    await pool.awardDraw(epoch, dec.abiEncodedClearValues, dec.decryptionProof)
  ).wait();
  ok(`awardDraw verified on-chain via checkSignatures, gas ${awardRc?.gasUsed}`);

  const draw = await pool.draws(epoch);
  ok(`draw ${epoch}: total=${draw.totalCumulative} prize=${draw.prize} awarded=${draw.awarded}`);

  // ---------------------------------------------------------------------
  step(4, "checkPrize() — constant-cost, outcome stays encrypted");

  const chkRc = await (await pool.checkPrize(epoch)).wait();
  ok(`checkPrize mined, gas ${chkRc?.gasUsed}`);

  const winHandle = await pool.winningsOf(me);
  const winnings = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    winHandle,
    poolD.address,
    signer
  );
  ok(`winnings decrypt to ${winnings}`);

  // With a single depositor, userCumulative == totalCumulative, so
  // uniform(prn, total) < userCumulative holds for every prn in range — the
  // sole participant always wins. Anything else means the prize path is broken
  // (most likely a saturating transfer that left the reserve empty).
  if (winnings === 0n) {
    throw new Error(
      "Sole depositor did not win. Expected a credited prize — check that the " +
        "reserve was actually funded (ERC7984 transfers saturate silently)."
    );
  }
  ok(`sole depositor won as expected (prize ${draw.prize})`);

  console.log("\nSPIKE PASSED — encrypt, userDecrypt, publicDecrypt+checkSignatures,");
  console.log("and an end-to-end prize credit all verified live on Sepolia.");
}

main().catch((e) => {
  console.error("\nSPIKE FAILED\n", e);
  process.exitCode = 1;
});
