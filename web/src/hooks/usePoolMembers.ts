import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Abi, Address, Hex, PublicClient } from "viem";
import { parseAbiItem } from "viem";
import { contracts, DEPLOY_BLOCK } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";

const poolAbi = prizePoolAbi as unknown as Abi;
const DEPOSITED = parseAbiItem("event Deposited(address indexed user)");

export type Member = { address: Address; handle: Hex };

/// Every Sepolia RPC caps `eth_getLogs` by block range, and they disagree about
/// the cap: the default provider allows 1,000 blocks, others 50,000, paid
/// endpoints far more. Start optimistic and halve on rejection rather than
/// hard-coding the smallest common denominator, which would cost hundreds of
/// round trips on a generous endpoint.
///
/// Measured over 36,961 blocks on 2026-08-10: publicnode accepts 9,000-block
/// chunks (5 calls, 1.7s); the default provider settles at ~562 (70 calls,
/// 41s); Alchemy's free tier caps at TEN blocks, which no amount of chunking
/// rescues — that is ~3,700 round trips, so we fail fast and say so instead.
///
/// TEMPORARY. The redeployed pool keeps its own participant array, after which
/// the register is a single contract read and this whole file goes away.
const CHUNK_START = 9_000n;
const CHUNK_MIN = 250n;

/// A range error is the provider telling us to ask for less. Anything else — a
/// dead endpoint, a rate limit — must not be retried by narrowing, because
/// narrowing makes rate limiting worse.
function isRangeError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (
    m.includes("block range") ||
    m.includes("exceeds defined limit") ||
    m.includes("requested blocks") ||
    m.includes("log response size") ||
    m.includes("query returned more than")
  );
}

async function scanDepositors(
  client: PublicClient,
  pool: Address,
  from: bigint,
  to: bigint
): Promise<Address[]> {
  const found: Address[] = [];
  const seen = new Set<string>();
  let chunk = CHUNK_START;
  let cursor = from;

  while (cursor <= to) {
    const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n;
    try {
      const logs = await client.getLogs({
        address: pool,
        event: DEPOSITED,
        fromBlock: cursor,
        toBlock: end,
      });
      for (const l of logs) {
        const a = l.args.user as Address | undefined;
        if (!a || seen.has(a.toLowerCase())) continue;
        seen.add(a.toLowerCase());
        found.push(a);
      }
      cursor = end + 1n;
    } catch (e) {
      if (isRangeError(e)) {
        if (chunk > CHUNK_MIN) {
          chunk = chunk / 2n > CHUNK_MIN ? chunk / 2n : CHUNK_MIN;
          continue; // same cursor, smaller bite
        }
        // Still refused at the smallest bite we are willing to take. Some
        // providers cap log queries at ten blocks, which would be thousands of
        // round trips — better to say the endpoint is unsuitable than to
        // hammer it for minutes.
        throw new Error(
          "This RPC limits log queries too aggressively to read the register. " +
            "Set VITE_SEPOLIA_RPC_URL to a provider with a usable eth_getLogs range."
        );
      }
      throw e;
    }
  }
  return found;
}

/// Remember what we have already scanned, so a returning visitor walks only the
/// blocks produced since their last visit rather than the whole chain again.
type Cache = { lastBlock: string; addresses: Address[] };

function cacheKey(pool: Address) {
  return `p2g:roster:${pool.toLowerCase()}`;
}

function readCache(pool: Address): Cache | null {
  try {
    const raw = localStorage.getItem(cacheKey(pool));
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    return Array.isArray(c.addresses) && typeof c.lastBlock === "string" ? c : null;
  } catch {
    return null;
  }
}

function writeCache(pool: Address, c: Cache) {
  try {
    localStorage.setItem(cacheKey(pool), JSON.stringify(c));
  } catch {
    /* private browsing, quota — the cache is an optimisation, not state */
  }
}

/// Everyone who has ever deposited, paired with their CURRENT stake ciphertext.
///
/// The pool contract keeps no participant array — winner selection is a
/// per-user predicate, so it never needs to iterate anyone. That is what keeps
/// the draw O(1). The roster is therefore reconstructed from `Deposited` logs,
/// which is the right place for it: it is presentation, not consensus.
///
/// The handles returned here are the real on-chain ciphertexts. Nobody can read
/// them without the holder's key, which is the entire point of showing them.
///
/// `members === null` means "not known yet", NOT "nobody". Callers must not
/// treat a failed scan as an empty pool — doing so previously made every user
/// look like a first-time visitor.
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
        const latest = await publicClient.getBlockNumber();
        const cached = readCache(c.prizePool);
        const cachedFrom = cached ? BigInt(cached.lastBlock) + 1n : 0n;
        const from = cachedFrom > DEPLOY_BLOCK ? cachedFrom : DEPLOY_BLOCK;

        const fresh =
          from > latest
            ? []
            : await scanDepositors(publicClient, c.prizePool, from, latest);

        // Oldest-first in storage; the view wants most-recent-first.
        const seen = new Set<string>();
        const ordered: Address[] = [];
        for (const a of [...(cached?.addresses ?? []), ...fresh]) {
          if (seen.has(a.toLowerCase())) continue;
          seen.add(a.toLowerCase());
          ordered.push(a);
        }
        writeCache(c.prizePool, { lastBlock: latest.toString(), addresses: ordered });

        const display = [...ordered].reverse();
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
        // Leave `members` null. An unreadable register is not an empty one, and
        // conflating the two is how this hook previously convinced every user
        // that they had never deposited.
        if (!cancelled) {
          setError(
            DEPLOY_BLOCK === 0n
              ? "The register needs VITE_DEPLOY_BLOCK set to the pool's deployment block."
              : (e as Error).message
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, refreshKey]);

  return { members, error };
}
