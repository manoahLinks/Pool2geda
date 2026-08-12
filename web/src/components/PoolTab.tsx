import { useAccount, usePublicClient } from "wagmi";
import type { Abi, Hex } from "viem";
import { Badge, Button, Card } from "@/components/ui";
import { Value, ForeignValue } from "@/components/Value";
import { Rosette } from "@/components/Rosette";
import type { Secret } from "@/hooks/useSecret";
import { useWrite } from "@/hooks/useWrite";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { usePool, type Phase } from "@/hooks/usePool";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { publicDecryptWithRetry } from "@/lib/decrypt";
import { formatDuration, formatMoney, shortAddress } from "@/lib/format";
import { useShell } from "@/lib/shell";

const poolAbi = prizePoolAbi as unknown as Abi;

/// The pool as a whole: what the round is doing, and who is in it.
///
/// Every round transition here is permissionless — anyone can close or settle —
/// so the action button is shown to everybody rather than hidden behind an
/// admin flag. That openness is a large part of why the draw can be trusted,
/// and burying it would waste the argument.
export function PoolTab({
  refreshKey,
  onChanged,
  shares,
  onOpenResult,
}: {
  refreshKey: number;
  onChanged: () => void | Promise<void>;
  shares: Secret;
  onOpenResult: () => void | Promise<void>;
}) {
  const c = contracts!;
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { run } = useShell();
  const write = useWrite();
  const { getSdk } = useZamaSdk();
  const pool = usePool();
  const { members, error: rosterError } = usePoolMembers(refreshKey);

  async function closeRound() {
    const ok = await run("tx", () =>
      write({ address: c.prizePool, abi: poolAbi, functionName: "closeEpoch" })
    );
    if (ok) {
      await pool.refetchAll();
      onChanged();
    }
  }

  /// Decrypt the round's two public figures and prove them back to the
  /// contract. Handle order is load-bearing — the proof is bound to it.
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

      const sdk = await getSdk();
      const res = await publicDecryptWithRetry(sdk, [totalHandle, randHandle]);
      return write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "awardDraw",
        args: [last, res.cleartexts, res.decryptionProof],
      });
    });
    if (ok) {
      await pool.refetchAll();
      onChanged();
    }
  }

  /// Check, then immediately show the answer.
  ///
  /// These were two buttons — "Check my result", then "Reveal result" — which
  /// asked the user to press twice for a single question. The transaction and
  /// the decryption are separate on-chain events but they are one intention, so
  /// the second follows the first automatically.
  async function check() {
    if (pool.last === null) return;
    const ok = await run("tx", () =>
      write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "checkPrize",
        args: [pool.last],
      })
    );
    if (!ok) return;
    await pool.refetchAll();
    await onChanged();
    await onOpenResult();
  }

  const r = roundCopy(pool.phase, pool.last, pool.remaining);

  // Only the two actions that are genuinely the user's get a primary button.
  //
  // `checkPrize` credits `msg.sender`, so a keeper running it would credit
  // itself — it cannot be automated, and it is the user's own. Revealing needs
  // their key. Closing and settling are neither: they are plumbing, a keeper
  // runs them on a schedule, and putting them in front of a saver as a demand
  // makes the product look like it needs operating.
  const act =
    pool.phase === "settled"
      ? check
      : pool.phase === "checked"
        ? onOpenResult
        : null;

  // Still reachable, deliberately. Anyone being able to close and settle is a
  // trust property — nobody can withhold a draw — and hiding it entirely would
  // throw that argument away. So it stays, as a quiet secondary control rather
  // than the thing the page is asking for.
  const manual =
    pool.phase === "timeup"
      ? { label: "Close it yourself", fn: closeRound }
      : pool.phase === "closed"
        ? { label: "Settle it yourself", fn: settle }
        : null;

  return (
    <div className="stagger space-y-5">
      {/* ── round ─────────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="label">
                Round {pool.epoch?.toString() ?? "—"}
              </span>
              <Badge tone={r.tone}>{r.status}</Badge>
            </div>
            <div className="num mt-3 text-[38px] leading-none font-extrabold">
              {r.metric}
            </div>
            <p className="m-0 mt-3 max-w-[54ch] text-[14px] leading-relaxed text-muted">
              {r.body}
            </p>
            {/* What this round actually pays. Accrues with the clock, so it is
                smaller early on — the ceiling sits beside it for context. */}
            <div className="mt-5 flex items-baseline gap-2.5">
              <span className="label">Prize</span>
              <span className="num text-[20px] font-extrabold text-mint">
                {pool.prize !== undefined ? formatMoney(pool.prize) : "—"} cUSD
              </span>
              {pool.prizeCeiling !== undefined && (
                <span className="text-[13px] text-muted">
                  of {formatMoney(pool.prizeCeiling)} max
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            <Rosette
              seed={pool.draw?.awarded ? pool.draw.randomness : pool.epoch}
              size={72}
              className="hidden text-accent-soft opacity-40 sm:block"
            />
            {act && (
              <Button size="lg" onClick={act}>
                {r.cta}
              </Button>
            )}
            {manual && (
              <button
                type="button"
                onClick={manual.fn}
                className="cursor-pointer text-[13px] font-bold text-muted underline underline-offset-4 transition-colors hover:text-text"
              >
                {manual.label}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* ── register ──────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
          <div>
            <h2 className="m-0 text-[17px] font-extrabold">Savers in this pool</h2>
            <p className="m-0 mt-1 text-[13.5px] text-muted">
              Every member is public. Not one balance is.
            </p>
          </div>
          <Badge>{members ? `${members.length} saver${members.length === 1 ? "" : "s"}` : "—"}</Badge>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-x-4 px-6 py-3 text-[12px] font-bold text-muted">
          <span>WALLET</span>
          <span className="text-right">DEPOSIT</span>
        </div>

        {rosterError ? (
          <div className="px-6 py-12 text-center text-[14px] text-muted">
            Couldn’t read the register from this network. Your own balance is
            unaffected — it comes straight from the contract.
          </div>
        ) : members === null ? (
          <div className="px-6 py-12 text-center text-[14px] text-muted">
            Loading savers…
          </div>
        ) : members.length === 0 ? (
          <div className="px-6 py-12 text-center text-[14px] text-muted">
            No deposits yet. Be the first — you’ll appear here as an address and
            nothing more.
          </div>
        ) : (
          members.map((m) => {
            const mine = m.address.toLowerCase() === address?.toLowerCase();
            return (
              <div
                key={m.address}
                className={
                  "grid grid-cols-[1fr_auto] items-center gap-x-4 border-t border-line px-6 py-4 transition-colors " +
                  (mine ? "bg-accent/8" : "hover:bg-surface-2")
                }
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="mono truncate">{shortAddress(m.address)}</span>
                  {mine && <Badge tone="accent">You</Badge>}
                </span>
                <span className="justify-self-end">
                  {mine ? (
                    <Value
                      handle={m.handle}
                      secret={shares}
                      label="your deposit"
                      size="sm"
                    />
                  ) : (
                    <ForeignValue handle={m.handle} />
                  )}
                </span>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

function roundCopy(
  phase: Phase,
  last: bigint | null,
  remaining: number | null
): {
  status: string;
  tone: "neutral" | "accent" | "mint" | "danger";
  metric: string;
  body: string;
  cta: string;
} {
  const prev = last?.toString() ?? "—";
  switch (phase) {
    case "timeup":
      return {
        status: "Ready to close",
        tone: "accent",
        metric: "Time’s up",
        body: "Someone needs to close this round so a winner can be drawn. Anyone can — including you, right now.",
        cta: "Close round",
      };
    case "closed":
      return {
        status: "Settling",
        tone: "accent",
        metric: `Round ${prev} closed`,
        body: "Its two public figures are being decrypted and proved back to the contract. This step is open to anyone and reveals nothing about any individual.",
        cta: "",
      };
    case "settled":
      return {
        status: "Draw complete",
        tone: "mint",
        metric: `Round ${prev} settled`,
        body: "Find out whether the prize came to you. Winning and losing cost the same gas and look identical onchain, so checking tells nobody anything — including whoever is watching this transaction.",
        cta: "Check my result",
      };
    case "checked":
      return {
        status: "Result ready",
        tone: "mint",
        metric: "Your result is waiting",
        body: "The answer is sitting in your winnings, encrypted. Only your key opens it.",
        cta: "Reveal result",
      };
    default:
      return {
        status: "Open",
        tone: "neutral",
        metric: remaining !== null ? formatDuration(remaining) : "—",
        body: "Deposits are earning odds right now. The longer your money sits here, the better your chances in the draw.",
        cta: "",
      };
  }
}
