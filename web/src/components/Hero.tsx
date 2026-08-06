import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { formatUnits, secondsUntil, formatDuration } from "@/lib/format";
import { Guilloche } from "@/components/Guilloche";

const poolAbi = prizePoolAbi as unknown as Abi;

type Draw = { totalCumulative: bigint; randomness: bigint; prize: bigint; awarded: boolean };

export function Hero({ memberCount }: { memberCount: number | null }) {
  const c = contracts!;
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: prize } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "prizePerDraw",
    query: { refetchInterval: 30_000 },
  });
  const { data: endsAt } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "epochEndsAt",
    query: { refetchInterval: 10_000 },
  });
  const { data: epochRaw } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "epoch",
    query: { refetchInterval: 10_000 },
  });

  const epoch = epochRaw as bigint | undefined;
  const last = epoch !== undefined && epoch > 0n ? epoch - 1n : null;
  const { data: lastDraw } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "draws",
    args: last !== null ? [last] : undefined, query: { enabled: last !== null },
  });

  // The rosette is cut from the last settled round's entropy. Same principle
  // as a banknote: the pattern is machine-generated from parameters you cannot
  // read back off the paper — except here those parameters are the draw itself.
  const draw = lastDraw as unknown as Draw | undefined;
  const rosetteSeed: bigint | undefined = draw?.awarded ? draw.randomness : epoch;

  const remaining = secondsUntil((endsAt as bigint) ?? 0n);

  return (
    <div className="relative overflow-hidden border border-ink/20 bg-stock-2/30">
      <div className="pointer-events-none absolute -top-16 -right-16 opacity-[0.22]">
        <Guilloche seed={rosetteSeed} size={300} passes={7} className="text-bank" />
      </div>
      <div className="pointer-events-none absolute -bottom-24 -left-20 opacity-[0.13]">
        <Guilloche seed={epoch} size={260} passes={5} className="text-bank" />
      </div>

      <div className="relative px-6 py-8 sm:px-9 sm:py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="serif-caps text-[10px] text-bank">
              Prize payable to the bearer of one winning stake
            </p>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="engraved text-6xl leading-none sm:text-7xl">
                {prize !== undefined ? formatUnits(prize as bigint) : "—"}
              </span>
              <span className="display text-xl text-bank">cUSD</span>
            </div>
          </div>

          <div className="hidden shrink-0 text-right sm:block">
            <p className="serif-caps text-[9px] text-faint">Round</p>
            <p className="engraved text-3xl leading-none">
              {epoch !== undefined ? epoch.toString().padStart(3, "0") : "—"}
            </p>
          </div>
        </div>

        <div className="rule-double mt-7 pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="serif-caps text-[9px] text-faint">Drawn in</dt>
              <dd className="font-mono text-sm tabular-nums">
                {endsAt !== undefined ? formatDuration(remaining) : "…"}
              </dd>
            </div>
            <div>
              <dt className="serif-caps text-[9px] text-faint">Holders</dt>
              <dd className="font-mono text-sm tabular-nums">{memberCount ?? "—"}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="serif-caps text-[9px] text-faint">Stakes on record</dt>
              <dd className="font-mono text-sm">sealed — every one</dd>
            </div>
          </dl>
        </div>

        <p className="mt-6 max-w-lg text-[13.5px] leading-[1.7] text-ink/75">
          Deposit and your stake is sealed on entry. It earns you odds on every
          draw in proportion to how much you hold and how long you have held it,
          and you may withdraw the whole of it at any hour. No holder&rsquo;s
          balance, odds, or winnings are legible to any other party — nor to the
          contract that pays them.
        </p>
      </div>
    </div>
  );
}
