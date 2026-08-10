import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const EPOCH = 24 * 3600; // 1 day
const PRIZE = 10_000_000n; // 10 cUSD (6 decimals)
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 3600;

async function deployFixture() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  const usd = await (await ethers.getContractFactory("TestUSD")).deploy(deployer.address);
  const usdAddr = await usd.getAddress();

  const cusd = await (await ethers.getContractFactory("ConfidentialUSD")).deploy(usdAddr);
  const cusdAddr = await cusd.getAddress();

  const pool = await (
    await ethers.getContractFactory("ConfidentialPrizePool")
  ).deploy(cusdAddr, EPOCH, PRIZE, deployer.address);
  const poolAddr = await pool.getAddress();

  return { usd, usdAddr, cusd, cusdAddr, pool, poolAddr, signers, deployer };
}

/// Mint -> approve -> wrap -> grant the pool operator rights.
async function fund(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  who: HardhatEthersSigner,
  amount: bigint
) {
  const { usd, cusd, cusdAddr, poolAddr, deployer } = ctx;
  await usd.connect(deployer).mintTo(who.address, amount);
  await usd.connect(who).approve(cusdAddr, amount);
  await cusd.connect(who).wrap(who.address, amount);
  await cusd.connect(who).setOperator(poolAddr, FAR_FUTURE);
}

async function encrypted(
  contractAddr: string,
  user: HardhatEthersSigner,
  value: bigint
) {
  const enc = await fhevm
    .createEncryptedInput(contractAddr, user.address)
    .add64(value)
    .encrypt();
  return { handle: enc.handles[0], proof: enc.inputProof };
}

async function deposit(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  who: HardhatEthersSigner,
  amount: bigint
) {
  const { pool, poolAddr } = ctx;
  const e = await encrypted(poolAddr, who, amount);
  await pool.connect(who).deposit(e.handle, e.proof);
}

async function decryptFor(
  handle: string,
  contractAddr: string,
  user: HardhatEthersSigner
): Promise<bigint> {
  return await fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, user);
}

/// Close the epoch, publicly decrypt the two handles, and submit the draw.
/// Mirrors exactly what the off-chain keeper does.
async function runDraw(ctx: Awaited<ReturnType<typeof deployFixture>>, epochId: number) {
  const { pool } = ctx;
  await time.increaseTo((await pool.epochEndsAt()) + 1n);
  await pool.closeEpoch();

  const totalHandle = await pool.pendingTotalHandle(epochId);
  const randHandle = await pool.pendingRandomHandle(epochId);

  const instance = await fhevm.createInstance();
  // Handle order is bound into the decryption proof — must match the
  // contract's `cts` array.
  const dec = (await instance.publicDecrypt([totalHandle, randHandle])) as {
    clearValues: Record<string, bigint | boolean>;
    abiEncodedClearValues: string;
    decryptionProof: string;
  };

  await pool.awardDraw(epochId, dec.abiEncodedClearValues, dec.decryptionProof);
  return dec;
}

describe("ConfidentialPrizePool", function () {
  beforeEach(function () {
    if (!fhevm.isMock) {
      console.warn("Skipping — not running on mock FHEVM");
      this.skip();
    }
  });

  describe("deposit / withdraw — no loss", function () {
    it("credits the deposited amount as encrypted shares", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 40_000_000n);

      const shares = await ctx.pool.sharesOf(alice.address);
      expect(await decryptFor(shares, ctx.poolAddr, alice)).to.equal(40_000_000n);
    });

    it("returns full principal on withdraw — no loss", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 40_000_000n);

      const e = await encrypted(ctx.poolAddr, alice, 40_000_000n);
      await ctx.pool.connect(alice).withdraw(e.handle, e.proof);

      expect(await decryptFor(await ctx.pool.sharesOf(alice.address), ctx.poolAddr, alice)).to.equal(0n);

      const bal = await ctx.cusd.confidentialBalanceOf(alice.address);
      expect(await decryptFor(bal, ctx.cusdAddr, alice)).to.equal(100_000_000n);
    });

    it("withdrawing more than balance moves zero and does not corrupt shares", async function () {
      // ERC7984._update saturates rather than reverting. If we decremented by
      // the *requested* amount instead of the amount actually moved, shares
      // would underflow and wrap to a huge number.
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 10_000_000n);

      const e = await encrypted(ctx.poolAddr, alice, 999_000_000n);
      await ctx.pool.connect(alice).withdraw(e.handle, e.proof);

      // Capped at their own principal — they get exactly their 10, not more,
      // and shares land on 0 rather than wrapping.
      expect(await decryptFor(await ctx.pool.sharesOf(alice.address), ctx.poolAddr, alice)).to.equal(0n);
      const bal = await ctx.cusd.confidentialBalanceOf(alice.address);
      expect(await decryptFor(bal, ctx.cusdAddr, alice)).to.equal(100_000_000n);
    });

    it("keeps withdrawals open while a draw is live", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);
      await runDraw(ctx, 0);

      const e = await encrypted(ctx.poolAddr, alice, 50_000_000n);
      await expect(ctx.pool.connect(alice).withdraw(e.handle, e.proof)).to.not.be.reverted;
    });
  });

  describe("draw lifecycle", function () {
    it("rejects closeEpoch before the epoch is over", async function () {
      const ctx = await deployFixture();
      await expect(ctx.pool.closeEpoch()).to.be.revertedWithCustomError(ctx.pool, "EpochNotOver");
    });

    it("rejects a draw on an empty pool rather than bricking claims", async function () {
      const ctx = await deployFixture();
      await time.increaseTo((await ctx.pool.epochEndsAt()) + 1n);
      await ctx.pool.closeEpoch();

      const instance = await fhevm.createInstance();
      const dec = (await instance.publicDecrypt([
        await ctx.pool.pendingTotalHandle(0),
        await ctx.pool.pendingRandomHandle(0),
      ])) as { abiEncodedClearValues: string; decryptionProof: string };

      await expect(
        ctx.pool.awardDraw(0, dec.abiEncodedClearValues, dec.decryptionProof)
      ).to.be.revertedWithCustomError(ctx.pool, "NothingToDraw");
    });

    it("is write-once — a second awardDraw reverts", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);
      const dec = await runDraw(ctx, 0);

      await expect(
        ctx.pool.awardDraw(0, dec.abiEncodedClearValues, dec.decryptionProof)
      ).to.be.revertedWithCustomError(ctx.pool, "DrawAlreadyAwarded");
    });

    it("rejects checkPrize twice for the same draw", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);
      await runDraw(ctx, 0);

      await ctx.pool.connect(alice).checkPrize(0);
      await expect(ctx.pool.connect(alice).checkPrize(0)).to.be.revertedWithCustomError(
        ctx.pool,
        "AlreadyChecked"
      );
    });
  });

  describe("prizes", function () {
    it("a sole depositor always wins, and can claim the prize", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      const { deployer } = ctx;

      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);

      // Fund the reserve from a separate account so principal is untouched.
      await fund(ctx, deployer, 100_000_000n);
      const f = await encrypted(ctx.poolAddr, deployer, 100_000_000n);
      await ctx.pool.connect(deployer).fundPrize(f.handle, f.proof);

      await runDraw(ctx, 0);
      await ctx.pool.connect(alice).checkPrize(0);

      // Sole depositor holds 100% of the TWAB, so uniform(prn, total) < userTwab
      // holds for every prn in range.
      const won = await decryptFor(await ctx.pool.winningsOf(alice.address), ctx.poolAddr, alice);
      expect(won).to.equal(PRIZE);

      await ctx.pool.connect(alice).claim();
      expect(
        await decryptFor(await ctx.pool.winningsOf(alice.address), ctx.poolAddr, alice)
      ).to.equal(0n);
    });

    it("credits nothing when the reserve is empty — never an unpayable win", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);

      await runDraw(ctx, 0); // reserve never funded
      await ctx.pool.connect(alice).checkPrize(0);

      expect(
        await decryptFor(await ctx.pool.winningsOf(alice.address), ctx.poolAddr, alice)
      ).to.equal(0n);
    });

    it("checkPrize costs the same for a winner and a loser", async function () {
      // The confidentiality claim, asserted mechanically: an observer must not
      // be able to infer the outcome from gas. Alice holds ~all of the TWAB, so
      // she wins; Bob deposits a dust amount late and effectively never wins.
      const ctx = await deployFixture();
      const [, alice, bob] = ctx.signers;
      const { deployer } = ctx;

      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 100_000_000n);

      await fund(ctx, deployer, 100_000_000n);
      const f = await encrypted(ctx.poolAddr, deployer, 100_000_000n);
      await ctx.pool.connect(deployer).fundPrize(f.handle, f.proof);

      await time.increase(EPOCH - 60);
      await fund(ctx, bob, 1_000_000n);
      await deposit(ctx, bob, 1n); // dust, held for seconds

      await runDraw(ctx, 0);

      const aliceGas = (await (await ctx.pool.connect(alice).checkPrize(0)).wait())!.gasUsed;
      const bobGas = (await (await ctx.pool.connect(bob).checkPrize(0)).wait())!.gasUsed;

      const aliceWon = await decryptFor(
        await ctx.pool.winningsOf(alice.address),
        ctx.poolAddr,
        alice
      );
      const bobWon = await decryptFor(await ctx.pool.winningsOf(bob.address), ctx.poolAddr, bob);

      expect(aliceWon).to.equal(PRIZE);
      expect(bobWon).to.equal(0n);
      expect(aliceGas).to.equal(bobGas);
    });

    it("TWAB defeats a large last-second deposit", async function () {
      // Bob deposits 100x Alice's stake but holds it for ~0.3% of the epoch.
      // Time-weighted, Alice's share is ~74% and Bob's ~26%; on *instantaneous*
      // balances Bob would hold 99% and dominate every draw. Measure actual
      // outcomes rather than asserting the arithmetic we already believe.
      this.timeout(20 * 60 * 1000);

      const ROUNDS = 16;
      let aliceWins = 0;
      let bobWins = 0;

      for (let r = 0; r < ROUNDS; r++) {
        const ctx = await deployFixture();
        const [, alice, bob] = ctx.signers;
        const { deployer } = ctx;

        await fund(ctx, alice, 10_000_000n);
        await deposit(ctx, alice, 10_000_000n);

        await fund(ctx, deployer, 100_000_000n);
        const f = await encrypted(ctx.poolAddr, deployer, 100_000_000n);
        await ctx.pool.connect(deployer).fundPrize(f.handle, f.proof);

        // Bob arrives with 100x the stake, 5 minutes before the epoch closes.
        await time.increase(EPOCH - 300);
        await fund(ctx, bob, 1_000_000_000n);
        await deposit(ctx, bob, 1_000_000_000n);

        await runDraw(ctx, 0);
        await ctx.pool.connect(alice).checkPrize(0);
        await ctx.pool.connect(bob).checkPrize(0);

        if ((await decryptFor(await ctx.pool.winningsOf(alice.address), ctx.poolAddr, alice)) > 0n)
          aliceWins++;
        if ((await decryptFor(await ctx.pool.winningsOf(bob.address), ctx.poolAddr, bob)) > 0n)
          bobWins++;
      }

      console.log(
        `      alice ${aliceWins}/${ROUNDS}, bob ${bobWins}/${ROUNDS} ` +
          `(bob holds 99% of balance but ~26% of TWAB)`
      );
      // The whole point: a 100x stake held briefly does not buy proportional odds.
      expect(bobWins).to.be.lessThan(ROUNDS);
      expect(aliceWins).to.be.greaterThan(0);
    });
  });

  describe("TWAB accounting invariants", function () {
    it("per-user accumulators sum to the public total, in the deposited ratio", async function () {
      // Directly validates the inputs to the winner predicate, rather than
      // inferring correctness from a noisy win count. If this holds, any
      // deviation in observed win frequency is sampling variance.
      const ctx = await deployFixture();
      const [, alice, bob] = ctx.signers;

      await fund(ctx, alice, 30_000_000n);
      await deposit(ctx, alice, 30_000_000n);
      await fund(ctx, bob, 10_000_000n);
      await deposit(ctx, bob, 10_000_000n);

      const dec = await runDraw(ctx, 0);
      const total = (await ctx.pool.draws(0)).totalCumulative;

      // Force each user's lazy rollover so _cumPrev is materialised.
      await ctx.pool.connect(alice).checkPrize(0);
      await ctx.pool.connect(bob).checkPrize(0);

      const aliceCum = await decryptFor(
        await ctx.pool.cumulativePrevOf(alice.address),
        ctx.poolAddr,
        alice
      );
      const bobCum = await decryptFor(
        await ctx.pool.cumulativePrevOf(bob.address),
        ctx.poolAddr,
        bob
      );

      const sum = aliceCum + bobCum;
      const pctAlice = Number((aliceCum * 10000n) / total) / 100;
      const pctBob = Number((bobCum * 10000n) / total) / 100;
      console.log(
        `      alice ${pctAlice}%, bob ${pctBob}%, sum/total = ${Number((sum * 10000n) / total) / 100}%`
      );

      // Deposits land a few seconds apart, so allow a small tolerance.
      expect(pctAlice).to.be.closeTo(75, 1);
      expect(pctBob).to.be.closeTo(25, 1);
      // The accumulators must account for the whole public total, or the
      // odds would not sum to 1 and the draw would be biased.
      expect(Number((sum * 10000n) / total) / 100).to.be.closeTo(100, 1);
      void dec;
    });
  });

  describe("epoch overrun", function () {
    it("credits deposits made after the timer elapsed to the NEXT epoch", async function () {
      // `closeEpoch` is permissionless, so an epoch can sit expired-but-unclosed.
      // Activity in that window must land in the next epoch, not retroactively
      // in the one whose timer already ran out. Without clamping, the deposit
      // pushed the accrual cursor past the boundary, closeEpoch's accrual
      // no-opped, and the epoch settled with a zero total — which surfaced on
      // Sepolia as awardDraw reverting NothingToDraw.
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);

      // Let epoch 0 expire with nobody in the pool, then deposit during the
      // overrun window.
      await time.increaseTo((await ctx.pool.epochEndsAt()) + 600n);
      await deposit(ctx, alice, 50_000_000n);

      // Epoch 0 genuinely had no deposits, so it must refuse to draw.
      await ctx.pool.closeEpoch();
      const instance = await fhevm.createInstance();
      const dec0 = (await instance.publicDecrypt([
        await ctx.pool.pendingTotalHandle(0),
        await ctx.pool.pendingRandomHandle(0),
      ])) as { abiEncodedClearValues: string; decryptionProof: string };
      await expect(
        ctx.pool.awardDraw(0, dec0.abiEncodedClearValues, dec0.decryptionProof)
      ).to.be.revertedWithCustomError(ctx.pool, "NothingToDraw");

      // Epoch 1 holds the deposit and settles normally.
      await runDraw(ctx, 1);
      const draw1 = await ctx.pool.draws(1);
      expect(draw1.totalCumulative).to.be.greaterThan(0n);
      expect(draw1.awarded).to.equal(true);
    });
  });

  describe("yield source", function () {
    /// Deploy a source, fund it, and hand it to the pool.
    async function withSource(
      ctx: Awaited<ReturnType<typeof deployFixture>>,
      kind: "admin" | "streaming",
      funding: bigint
    ) {
      const { cusdAddr, poolAddr, deployer, pool, cusd } = ctx;
      const src =
        kind === "admin"
          ? await (
              await ethers.getContractFactory("AdminFundedYieldSource")
            ).deploy(cusdAddr, poolAddr, PRIZE, deployer.address)
          : await (
              await ethers.getContractFactory("StreamingYieldSource")
            ).deploy(cusdAddr, poolAddr, 1_000n, PRIZE * 10n, deployer.address);

      const srcAddr = await src.getAddress();
      await fund(ctx, deployer, funding);
      await cusd.connect(deployer).setOperator(srcAddr, FAR_FUTURE);
      const e = await encrypted(srcAddr, deployer, funding);
      await src.connect(deployer).fund(e.handle, e.proof);
      await pool.connect(deployer).setYieldSource(srcAddr);
      return { src, srcAddr };
    }

    it("fills the reserve on close, so a winner is paid from harvested yield", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);

      // The reserve is never funded directly — everything the winner receives
      // must arrive through the interface.
      await withSource(ctx, "admin", 100_000_000n);

      await runDraw(ctx, 0);
      await ctx.pool.connect(alice).checkPrize(0);

      const won = await decryptFor(
        await ctx.pool.winningsOf(alice.address),
        ctx.poolAddr,
        alice
      );
      expect(won).to.equal(PRIZE);
    });

    it("a streaming source pays more after a longer round", async function () {
      const ctx = await deployFixture();
      const { src } = await withSource(ctx, "streaming", 500_000_000n);

      const short = await src.accrued();
      await time.increase(600);
      const longer = await src.accrued();

      expect(longer).to.be.greaterThan(short);
      // And it is bounded, so a long silence cannot drain the stream into one
      // round.
      await time.increase(EPOCH * 100);
      expect(await src.accrued()).to.equal(PRIZE * 10n);
    });

    it("credits the reserve by what moved, not by what was requested", async function () {
      // The source is funded with less than one round's prize. ERC-7984
      // saturates, so the transfer succeeds having moved only what was there —
      // crediting the request would invent reserve against tokens that never
      // arrived, and eventually pay a prize out of principal.
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);

      const short = PRIZE / 4n;
      await withSource(ctx, "admin", short);

      await runDraw(ctx, 0);
      await ctx.pool.connect(alice).checkPrize(0);

      // Reserve holds a quarter prize, so the solvency gate declines to credit
      // a win it cannot pay rather than overdrawing.
      const won = await decryptFor(
        await ctx.pool.winningsOf(alice.address),
        ctx.poolAddr,
        alice
      );
      expect(won).to.equal(0n);

      // Principal is untouched throughout.
      const e = await encrypted(ctx.poolAddr, alice, 50_000_000n);
      await ctx.pool.connect(alice).withdraw(e.handle, e.proof);
      expect(
        await decryptFor(await ctx.cusd.confidentialBalanceOf(alice.address), ctx.cusdAddr, alice)
      ).to.equal(100_000_000n);
    });

    it("is optional — an unset source leaves the pool working as before", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);
      await expect(runDraw(ctx, 0)).to.not.be.reverted;
    });

    it("refuses harvest from anyone but the pool", async function () {
      const ctx = await deployFixture();
      const { src } = await withSource(ctx, "admin", 100_000_000n);
      await expect(
        src.connect(ctx.signers[1]).harvest(ctx.signers[1].address, PRIZE)
      ).to.be.revertedWithCustomError(src, "OnlyPool");
    });
  });

  describe("participant registry", function () {
    it("records each depositor exactly once, however often they deposit", async function () {
      const ctx = await deployFixture();
      const [, alice, bob] = ctx.signers;

      expect(await ctx.pool.participantCount()).to.equal(0n);

      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 10_000_000n);
      await deposit(ctx, alice, 10_000_000n); // same depositor again
      await fund(ctx, bob, 100_000_000n);
      await deposit(ctx, bob, 10_000_000n);

      expect(await ctx.pool.participantCount()).to.equal(2n);
      expect(await ctx.pool.participants()).to.deep.equal([alice.address, bob.address]);
      expect(await ctx.pool.isParticipant(alice.address)).to.equal(true);
      expect(await ctx.pool.isParticipant(ctx.signers[3].address)).to.equal(false);
    });
  });

  describe("dead time", function () {
    it("crosses a long gap in one call and mints no unclaimable draw", async function () {
      const ctx = await deployFixture();
      const alice = ctx.signers[1];
      await fund(ctx, alice, 100_000_000n);
      await deposit(ctx, alice, 50_000_000n);

      // Nobody closes for ten epochs.
      await time.increaseTo((await ctx.pool.epochEndsAt()) + BigInt(EPOCH * 10));
      await expect(ctx.pool.closeEpoch()).to.emit(ctx.pool, "DeadEpochsSkipped");

      // One call crossed the whole gap rather than advancing a single period.
      expect(await ctx.pool.epoch()).to.equal(11n);
      // And the pool is live again: the new epoch has not already expired.
      expect(await ctx.pool.epochEndsAt()).to.be.greaterThan(
        BigInt((await ethers.provider.getBlock("latest"))!.timestamp)
      );
      // No draw was created for the skipped round — a prize nobody could claim
      // is worse than no prize.
      expect(await ctx.pool.pendingTotalHandle(0)).to.equal(ethers.ZeroHash);
    });

    it("does not hand an idle depositor a guaranteed win after dead time", async function () {
      // THE invariant. Fast-forwarding the clock without advancing the epoch
      // counter by the same number of periods inflates `_cumPrev` to the whole
      // gap while `_totalCumPrev` still holds one epoch — after which
      // uniform(prn, total) can never exceed it and the idle user wins every
      // draw with certainty. Assert the accumulators still account for the
      // public total and nothing more.
      const ctx = await deployFixture();
      const [, alice, bob] = ctx.signers;

      await fund(ctx, alice, 20_000_000n);
      await deposit(ctx, alice, 20_000_000n);
      await fund(ctx, bob, 20_000_000n);
      await deposit(ctx, bob, 20_000_000n);

      // Long silence, then a catch-up close that skips the dead rounds.
      await time.increaseTo((await ctx.pool.epochEndsAt()) + BigInt(EPOCH * 20));
      await ctx.pool.closeEpoch();

      // Now a real round runs to completion.
      const live = await ctx.pool.epoch();
      await runDraw(ctx, Number(live));

      await ctx.pool.connect(alice).checkPrize(live);
      await ctx.pool.connect(bob).checkPrize(live);

      const total = (await ctx.pool.draws(live)).totalCumulative;
      const a = await decryptFor(
        await ctx.pool.cumulativePrevOf(alice.address),
        ctx.poolAddr,
        alice
      );
      const b = await decryptFor(
        await ctx.pool.cumulativePrevOf(bob.address),
        ctx.poolAddr,
        bob
      );

      console.log(
        `      after 20 dead epochs: alice=${a} bob=${b} total=${total} ` +
          `(sum/total = ${Number(((a + b) * 10000n) / total) / 100}%)`
      );

      // Neither may exceed the modulus — that is precisely the rigged-draw bug.
      expect(a).to.be.lessThanOrEqual(total);
      expect(b).to.be.lessThanOrEqual(total);
      // And together they still account for the whole public total, so odds
      // sum to one rather than to twenty.
      expect(Number(((a + b) * 10000n) / total) / 100).to.be.closeTo(100, 1);
    });
  });

  describe("weighted distribution", function () {
    it("win frequency tracks each depositor's share of the TWAB", async function () {
      // The core correctness claim. Alice holds 3x Bob's stake for the same
      // duration, so over many draws she should win roughly 3x as often.
      this.timeout(20 * 60 * 1000);

      const ROUNDS = 24;
      let aliceWins = 0;
      let bobWins = 0;

      for (let r = 0; r < ROUNDS; r++) {
        const ctx = await deployFixture();
        const [, alice, bob] = ctx.signers;
        const { deployer } = ctx;

        await fund(ctx, alice, 30_000_000n);
        await deposit(ctx, alice, 30_000_000n);
        await fund(ctx, bob, 10_000_000n);
        await deposit(ctx, bob, 10_000_000n);

        await fund(ctx, deployer, 100_000_000n);
        const f = await encrypted(ctx.poolAddr, deployer, 100_000_000n);
        await ctx.pool.connect(deployer).fundPrize(f.handle, f.proof);

        await runDraw(ctx, 0);

        await ctx.pool.connect(alice).checkPrize(0);
        await ctx.pool.connect(bob).checkPrize(0);

        const a = await decryptFor(await ctx.pool.winningsOf(alice.address), ctx.poolAddr, alice);
        const b = await decryptFor(await ctx.pool.winningsOf(bob.address), ctx.poolAddr, bob);
        if (a > 0n) aliceWins++;
        if (b > 0n) bobWins++;
      }

      // Expected split is 75/25. With 24 rounds this is noisy, so assert the
      // ordering and that both outcomes occur, rather than a tight ratio.
      console.log(`      alice ${aliceWins}/${ROUNDS}, bob ${bobWins}/${ROUNDS} (expect ~75%/~25%)`);
      expect(aliceWins + bobWins).to.be.greaterThan(0);
      expect(aliceWins).to.be.greaterThan(bobWins);
    });
  });
});
