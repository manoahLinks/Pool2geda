import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { formatUnits, secondsUntil, formatDuration } from "@/lib/format";

const poolAbi = prizePoolAbi as unknown as Abi;

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

  const remaining = secondsUntil((endsAt as bigint) ?? 0n);

  return (
    <div className="py-10 sm:py-14">
      <p className="font-mono text-[11px] tracking-[0.18em] text-mist/60 uppercase">
        Prize this round
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="display text-6xl font-extrabold text-reveal tabular-nums sm:text-7xl">
          {prize !== undefined ? formatUnits(prize as bigint) : "—"}
        </span>
        <span className="font-mono text-sm text-reveal/50">cUSD</span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-mist">
        <span>
          draws in{" "}
          <span className="text-white tabular-nums">
            {endsAt !== undefined ? formatDuration(remaining) : "…"}
          </span>
        </span>
        <span className="text-mist/30">·</span>
        <span>
          <span className="text-white tabular-nums">{memberCount ?? "—"}</span>{" "}
          {memberCount === 1 ? "saver" : "savers"}
        </span>
        <span className="text-mist/30">·</span>
        <span className="text-mist/70">nobody can see what anyone holds</span>
      </div>

      <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-mist">
        Put money in, win prizes, take it out whenever. Your stake is encrypted
        the moment it enters — your balance, your odds, and whether you won stay
        yours alone.
      </p>
    </div>
  );
}
