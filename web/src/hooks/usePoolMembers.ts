import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Abi, Address, Hex } from "viem";
import { parseAbiItem } from "viem";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";

const poolAbi = prizePoolAbi as unknown as Abi;
const DEPOSITED = parseAbiItem("event Deposited(address indexed user)");

export type Member = { address: Address; handle: Hex };

/// Everyone who has ever deposited, paired with their CURRENT stake ciphertext.
///
/// The pool contract keeps no participant array — winner selection is a
/// per-user predicate, so it never needs to iterate anyone. That is what keeps
/// the draw O(1). The roster is therefore reconstructed from Deposited events,
/// which is the right place for it: it is presentation, not consensus.
///
/// The handles returned here are the real on-chain ciphertexts. Nobody can
/// read them without the holder's key, which is the entire point of showing
/// them.
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
        const logs = await publicClient.getLogs({
          address: c.prizePool,
          event: DEPOSITED,
          fromBlock: 0n,
          toBlock: "latest",
        });

        // Most recent depositor first, de-duplicated.
        const seen = new Set<string>();
        const addresses: Address[] = [];
        for (let i = logs.length - 1; i >= 0; i--) {
          const a = logs[i].args.user as Address | undefined;
          if (!a || seen.has(a.toLowerCase())) continue;
          seen.add(a.toLowerCase());
          addresses.push(a);
        }

        const handles = await Promise.all(
          addresses.map((a) =>
            publicClient.readContract({
              address: c.prizePool,
              abi: poolAbi,
              functionName: "sharesOf",
              args: [a],
            }) as Promise<Hex>
          )
        );

        if (!cancelled) {
          setMembers(addresses.map((address, i) => ({ address, handle: handles[i] })));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          // A rate-limited RPC is the usual cause; the roster is cosmetic, so
          // fail quietly rather than blocking the page.
          setError((e as Error).message);
          setMembers([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, refreshKey]);

  return { members, error };
}
