import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import type { Abi } from "viem";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { secondsUntil } from "@/lib/format";

const poolAbi = prizePoolAbi as unknown as Abi;

/// Where the current round has got to.
///
///   running   the clock is still going; nothing to do
///   timeup    the clock ran out and somebody has to close it
///   closed    closed, but its numbers still need proving back to the contract
///   settled   proven; you can now find out whether the prize came to you
///   checked   you have checked, and the answer is sitting in your winnings
///
/// Every one of these transitions is permissionless — anyone can close a round
/// or settle it, which is a large part of why the draw can be trusted.
export type Phase = "running" | "timeup" | "closed" | "settled" | "checked";

/// `draws(id)` has four outputs, so viem hands back a tuple, not an object.
/// Reading it as `{ awarded }` yields undefined and the UI silently believes
/// every round is unsettled forever.
type DrawTuple = readonly [bigint, bigint, bigint, boolean];

export type Draw = {
  totalCumulative: bigint;
  randomness: bigint;
  prize: bigint;
  awarded: boolean;
};

function toDraw(raw: unknown): Draw | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined;
  const [totalCumulative, randomness, prize, awarded] = raw as unknown as DrawTuple;
  return { totalCumulative, randomness, prize, awarded };
}

/// One clock for the whole app, so the countdown in the hero and the countdown
/// on the round card can never disagree by a second.
function useTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

export function usePool() {
  const { address } = useAccount();
  const c = contracts;
  useTicker();

  const enabled = !!c;

  const { data: prize } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "prizePerDraw",
    query: { enabled, refetchInterval: 30_000 },
  });
  const { data: epochRaw, refetch: refetchEpoch } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "epoch",
    query: { enabled, refetchInterval: 10_000 },
  });
  const { data: endsAtRaw, refetch: refetchEnds } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "epochEndsAt",
    query: { enabled, refetchInterval: 10_000 },
  });

  const epoch = epochRaw as bigint | undefined;
  const endsAt = endsAtRaw as bigint | undefined;

  // The round you can still act on is the one that just closed — the claim
  // window is exactly one round wide.
  const last = epoch !== undefined && epoch > 0n ? epoch - 1n : null;

  const { data: drawRaw, refetch: refetchDraw } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "draws",
    args: last !== null ? [last] : undefined,
    query: { enabled: enabled && last !== null, refetchInterval: 15_000 },
  });
  const { data: checkedRaw, refetch: refetchChecked } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "checked",
    args: last !== null && address ? [last, address] : undefined,
    query: { enabled: enabled && last !== null && !!address },
  });

  const draw = toDraw(drawRaw);
  const alreadyChecked = checkedRaw === true;
  const remaining = endsAt !== undefined ? secondsUntil(endsAt) : null;
  const expired = remaining === 0;

  // Order matters. An unsettled previous round is the most urgent thing on the
  // page, because its claim window is closing. A round the user has already
  // checked is the least — so if the current round's clock has also run out,
  // "time is up" wins over "you already checked".
  let phase: Phase = "running";
  // `last` is by definition a round that has already been closed, so an
  // un-awarded draw there is one waiting to be settled.
  if (last !== null && draw && !draw.awarded) phase = "closed";
  else if (last !== null && draw?.awarded && !alreadyChecked) phase = "settled";
  else if (expired) phase = "timeup";
  else if (last !== null && draw?.awarded && alreadyChecked) phase = "checked";

  const refetchAll = async () => {
    await Promise.all([
      refetchEpoch(),
      refetchEnds(),
      refetchDraw(),
      refetchChecked(),
    ]);
  };

  return {
    prize: prize as bigint | undefined,
    epoch,
    endsAt,
    remaining,
    last,
    draw,
    alreadyChecked,
    phase,
    refetchAll,
  };
}
