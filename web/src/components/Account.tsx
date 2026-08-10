import { useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import type { Abi, Hex } from "viem";
import { AmountField, Button, Label, Plate } from "@/components/ui";
import { Seal } from "@/components/Value";
import { Holders } from "@/components/Holders";
import { useSecret } from "@/hooks/useSecret";
import { useWrite, useEncrypt } from "@/hooks/useWrite";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { usePool, type Phase } from "@/hooks/usePool";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { publicDecryptWithRetry, isZeroHandle } from "@/lib/decrypt";
import { formatDuration, formatMoney, parseUnits } from "@/lib/format";
import { SATURATED_TRANSFER } from "@/lib/errors";
import { useShell } from "@/lib/shell";

const poolAbi = prizePoolAbi as unknown as Abi;

export function Account({
  refreshKey,
  onTopUp,
  onChanged,
}: {
  refreshKey: number;
  onTopUp: () => void;
  onChanged: () => void;
}) {
  const c = contracts!;
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { run, notify, showResult } = useShell();
  const write = useWrite();
  const encrypt = useEncrypt();
  const { getSdk } = useZamaSdk();
  const pool = usePool();
  const { members } = usePoolMembers(refreshKey);

  const [amount, setAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  /// Winnings at the moment `checkPrize` was sent, when they happened to be
  /// unsealed. Without it a saver holding an older unclaimed prize would read
  /// any positive balance as "you won this round", which is not what it says.
  const [preCheck, setPreCheck] = useState<bigint | null>(null);

  const { data: sharesHandle, refetch: refetchShares } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "sharesOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: winningsHandle, refetch: refetchWinnings } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "winningsOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const shares = useSecret(sharesHandle as Hex | undefined, c.prizePool);
  const winnings = useSecret(winningsHandle as Hex | undefined, c.prizePool);

  const empty =
    members !== null &&
    !members.some((m) => m.address.toLowerCase() === address?.toLowerCase());

  // ── money ────────────────────────────────────────────────────────────────

  async function withdraw() {
    let v: bigint;
    try {
      v = parseUnits(amount);
    } catch (e) {
      notify({ tone: "bad", title: "Check the amount", body: (e as Error).message });
      return;
    }

    // The one case where a silent no-op can be prevented rather than explained:
    // the balance is already unsealed, so we can compare before signing.
    if (shares.value !== null && v > shares.value) {
      notify({ tone: "bad", ...SATURATED_TRANSFER });
      return;
    }

    const enc = await run("proof", () => encrypt(v, c.prizePool));
    if (!enc) return;
    const ok = await run("tx", () =>
      write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "withdraw",
        args: [enc.handle, enc.proof],
      })
    );
    if (!ok) return;

    setAmount("");
    setWithdrawing(false);
    shares.hide();
    await refetchShares();
    onChanged();
    notify({
      tone: "good",
      title: "Withdrawn",
      body: "Whatever moved is back in your private balance. Your figures re-sealed themselves because they changed — unseal them to read the new ones.",
    });
  }

  async function claim() {
    const ok = await run("tx", () =>
      write({ address: c.prizePool, abi: poolAbi, functionName: "claim" })
    );
    if (!ok) return;
    winnings.hide();
    await refetchWinnings();
    onChanged();
    notify({
      tone: "good",
      title: "Moved into your holding",
      body: "The prize is part of your private balance now, and nothing on the chain records that it landed with you.",
    });
  }

  // ── the round ────────────────────────────────────────────────────────────

  async function closeRound() {
    const ok = await run("tx", () =>
      write({ address: c.prizePool, abi: poolAbi, functionName: "closeEpoch" })
    );
    if (ok) await pool.refetchAll();
  }

  /// Fetch the round's two sealed figures, have them publicly decrypted, and
  /// prove them back to the contract.
  ///
  /// Handle order is load-bearing — the decryption proof is bound to it, and
  /// must match the contract's own array.
  async function settle() {
    if (pool.last === null || !publicClient) return;
    const last = pool.last;

    const ok = await run("settle", async () => {
      const [totalHandle, randHandle] = (await Promise.all([
        publicClient.readContract({
          address: c.prizePool,
          abi: poolAbi,
          functionName: "pendingTotalHandle",
          args: [last],
        }),
        publicClient.readContract({
          address: c.prizePool,
          abi: poolAbi,
          functionName: "pendingRandomHandle",
          args: [last],
        }),
      ])) as [Hex, Hex];

      // Retries built in: the relayer answers "not ready" for a few seconds
      // after a round closes, while the ciphertext reaches the gateway.
      const sdk = await getSdk();
      const res = await publicDecryptWithRetry(sdk, [totalHandle, randHandle]);

      return write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "awardDraw",
        args: [last, res.cleartexts, res.decryptionProof],
      });
    });
    if (!ok) return;
    await pool.refetchAll();
  }

  async function check() {
    if (pool.last === null) return;
    setPreCheck(winnings.value);
    const ok = await run("tx", () =>
      write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "checkPrize",
        args: [pool.last],
      })
    );
    if (!ok) return;
    winnings.hide();
    await Promise.all([pool.refetchAll(), refetchWinnings()]);
  }

  /// The reveal. Decrypt the winnings, then say what it means.
  async function openResult() {
    const v = await winnings.reveal();
    if (v === null) return;
    const won = preCheck !== null ? v > preCheck : v > 0n;
    showResult({ won, amount: v, round: (pool.last ?? 0n).toString() });
  }

  const round = roundCopy(pool.phase, pool.epoch, pool.last, pool.remaining);
  const roundAction =
    pool.phase === "timeup"
      ? closeRound
      : pool.phase === "closed"
        ? settle
        : pool.phase === "settled"
          ? check
          : pool.phase === "checked"
            ? openResult
            : null;

  const hasWinnings = !isZeroHandle(winningsHandle as Hex | undefined);

  return (
    <div className="stagger">
      {/* Hairline gaps: two plates reading as one instrument face, divided
          rather than floated apart. */}
      <div className="mb-10 grid gap-px bg-line/60 lg:grid-cols-12">
        <Plate className="rounded-none px-9 py-9 lg:col-span-7">
          <Label>Your holding</Label>
          <div className="mt-7">
            {empty ? (
              <>
                <div className="wide text-[clamp(28px,3.6vw,38px)] leading-[1.05] font-semibold">
                  Nothing sealed yet
                </div>
                <p className="m-0 mt-4 max-w-[42ch] text-[15px] leading-[1.65] text-slate">
                  From your first deposit, your balance is unreadable to everyone
                  but you — and your chances begin accruing that second.
                </p>
                <div className="mt-8">
                  <Button onClick={onTopUp}>Make your first deposit</Button>
                </div>
              </>
            ) : (
              <>
                <Seal
                  handle={sharesHandle as string | undefined}
                  secret={shares}
                  label="your holding"
                  cta="Unseal with your key"
                  scale="hero"
                />
                <div className="mt-9 flex flex-wrap gap-3">
                  <Button size="sm" onClick={onTopUp}>
                    Add to it
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setWithdrawing((w) => !w)}
                  >
                    {withdrawing ? "Cancel" : "Withdraw"}
                  </Button>
                </div>

                {withdrawing && (
                  <div className="rise mt-9 border-t border-line pt-8">
                    <div className="max-w-[380px]">
                      <AmountField
                        label="Amount to withdraw"
                        value={amount}
                        onChange={setAmount}
                        unit="private USD"
                        hint="Any amount, any hour — including mid-round"
                      />
                    </div>
                    <div className="mt-7">
                      <Button onClick={withdraw} disabled={!amount.trim()}>
                        Withdraw
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Plate>

        <Plate className="flex flex-col rounded-none px-9 py-9 lg:col-span-5">
          <Label>{round.line}</Label>
          <div className="fig mt-7 text-[clamp(34px,4.4vw,50px)] text-ink">
            {round.metric}
          </div>
          <p className="m-0 mt-5 max-w-[38ch] text-[14px] leading-[1.65] text-slate">
            {round.body}
          </p>
          {roundAction && (
            <div className="mt-auto pt-8">
              <Button onClick={roundAction}>{round.cta}</Button>
            </div>
          )}
        </Plate>
      </div>

      {/* Shown whenever winnings have ever been written, not only after this
          round's check — an unclaimed prize from an earlier round must not
          vanish from the page because a new round started. */}
      {hasWinnings && (
        <Plate className="mb-10 px-9 py-9">
          <Label tone="brass">Winnings, unclaimed</Label>
          <div className="mt-7">
            <Seal
              handle={winningsHandle as string | undefined}
              secret={winnings}
              label="your winnings"
              cta="Unseal winnings"
            />
          </div>
          {winnings.value !== null && winnings.value > 0n && (
            <div className="mt-8">
              <Button size="sm" variant="quiet" onClick={claim}>
                Move {formatMoney(winnings.value)} into your holding
              </Button>
            </div>
          )}
        </Plate>
      )}

      <Holders members={members} mine={shares} />
    </div>
  );
}

/// The round, in the saver's terms. Every one of these transitions is open to
/// anybody — closing and settling are permissionless, which is a large part of
/// why the draw can be trusted, so the copy says so rather than hiding it.
function roundCopy(
  phase: Phase,
  epoch: bigint | undefined,
  last: bigint | null,
  remaining: number | null
): { line: string; metric: string; body: string; cta: string } {
  const now = epoch !== undefined ? epoch.toString().padStart(3, "0") : "—";
  const prev = last !== null ? last.toString().padStart(3, "0") : "—";

  switch (phase) {
    case "timeup":
      return {
        line: `Round ${now}`,
        metric: "Time up",
        body: "The clock has run out and somebody has to close the round before a winner can be drawn. Anyone may — including you.",
        cta: "Close the round",
      };
    case "closed":
      return {
        line: `Round ${prev}`,
        metric: "Drawing",
        body: "Closed. Its two public figures need decrypting and proving back to the contract before anyone can check. Anyone may do this, and it discloses nothing about any individual.",
        cta: "Settle the round",
      };
    case "settled":
      return {
        line: `Round ${prev}`,
        metric: "Check open",
        body: "Find out whether the prize came to you. Winning and losing cost the same and look the same from outside, so the act of checking tells nobody anything.",
        cta: "Check my result",
      };
    case "checked":
      return {
        line: `Round ${prev}`,
        metric: "Result waiting",
        body: "The answer is sitting in your winnings, sealed. Only your key opens it.",
        cta: "Open the result",
      };
    default:
      return {
        line: `Round ${now} closes in`,
        metric: remaining !== null ? formatDuration(remaining) : "—",
        body: "Nothing to do. Every second the money sits here adds to your weight in the draw.",
        cta: "",
      };
  }
}
