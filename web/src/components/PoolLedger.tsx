import { useAccount } from "wagmi";
import type { Hex } from "viem";
import { Panel, Sealed } from "@/components/ui";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { useSecret } from "@/hooks/useSecret";
import { contracts } from "@/config/contracts";
import { shortAddress } from "@/lib/format";

/// The register of holders.
///
/// A share register lists who holds, and historically also how much. This one
/// cannot: each stake is drawn as guilloche cut from its own ciphertext, so the
/// register is complete and public while every figure in it stays private. Only
/// your own line can be struck into figures, and only by you.
export function PoolLedger({ refreshKey }: { refreshKey: unknown }) {
  const { address } = useAccount();
  const { members } = usePoolMembers(refreshKey);
  const c = contracts!;

  const mine = members?.find(
    (m) => m.address.toLowerCase() === address?.toLowerCase()
  );
  const mySecret = useSecret(mine?.handle as Hex | undefined, c.prizePool);

  return (
    <Panel caption="Register of holders">
      {members === null ? (
        <p className="font-mono text-xs text-faint">reading the register…</p>
      ) : members.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink/70">
          No stakes are entered yet. The first will appear here — sealed.
        </p>
      ) : (
        <ol className="divide-y divide-ink/10">
          {members.map((m, i) => {
            const isMine = m.address.toLowerCase() === address?.toLowerCase();
            return (
              <li
                key={m.address}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-faint/60 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={
                      "font-mono text-[11px] " +
                      (isMine ? "font-medium text-carmine" : "text-ink/70")
                    }
                  >
                    {isMine ? "bearer (you)" : shortAddress(m.address)}
                  </span>
                </span>
                {isMine ? (
                  <Sealed
                    handle={m.handle}
                    value={mySecret.value}
                    busy={mySecret.busy}
                    onReveal={mySecret.reveal}
                    size="sm"
                  />
                ) : (
                  <Sealed handle={m.handle} value={null} size="sm" />
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-4 border-t border-ink/10 pt-3 text-[11.5px] leading-relaxed text-faint">
        Each pattern is cut from the ciphertext that stake is actually stored as
        on-chain — no two alike, none of them readable. The register proves the
        pool is real without disclosing a single figure in it.
      </p>
    </Panel>
  );
}
