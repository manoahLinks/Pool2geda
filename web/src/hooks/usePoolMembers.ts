import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Abi, Address, Hex } from "viem";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";

const poolAbi = prizePoolAbi as unknown as Abi;

export type Member = { address: Address; handle: Hex };

/// Everyone who has ever deposited, paired with their CURRENT stake ciphertext.
///
/// The pool keeps this list itself, so reading it is one `eth_call` that
/// behaves identically on every provider. The previous version reconstructed it
/// from `Deposited` logs, which meant an `eth_getLogs` scan — and every RPC caps
/// that range differently and brutally (1,000 blocks on the provider viem
/// defaults to, ten on Alchemy's free tier), so the roster was unreadable on
/// most endpoints and silently reported an empty pool.
///
/// Nothing on-chain iterates the list, so the draw stays O(1) however long it
/// grows. See the registry note in ConfidentialPrizePool.
///
/// `members === null` means "not known yet", NOT "nobody". A failed read must
/// never present as an empty pool.
export function usePoolMembers(refreshKey: unknown) {
  const publicClient = usePublicClient();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!publicClient || !contracts) return;
    const c = contracts;

    (async () => {
      try {
        const roll = (await publicClient.readContract({
          address: c.prizePool,
          abi: poolAbi,
          functionName: "participants",
        })) as readonly Address[];

        // Most recent first — the newest saver is the interesting one.
        const display = [...roll].reverse();

        const handles = await Promise.all(
          display.map(
            (a) =>
              publicClient.readContract({
                address: c.prizePool,
                abi: poolAbi,
                functionName: "sharesOf",
                args: [a],
              }) as Promise<Hex>
          )
        );

        if (!cancelled) {
          setMembers(display.map((address, i) => ({ address, handle: handles[i] })));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, refreshKey]);

  return { members, error };
}
