import { useAccount } from "wagmi";
import { Card, Sealed } from "@/components/ui";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { useSecret } from "@/hooks/useSecret";
import { contracts } from "@/config/contracts";
import { shortAddress } from "@/lib/format";
import type { Hex } from "viem";

/// The pool, as the chain actually stores it.
///
/// Every row is a real depositor and their real stake ciphertext. You can see
/// the pool is populated and that every figure in it is unreadable — except
/// your own, which you hold the key to. This is the one thing here that could
/// not exist on a transparent chain, so it gets to be the centrepiece.
export function PoolLedger({ refreshKey }: { refreshKey: unknown }) {
  const { address } = useAccount();
  const { members } = usePoolMembers(refreshKey);
  const c = contracts!;

  const mine = members?.find(
    (m) => m.address.toLowerCase() === address?.toLowerCase()
  );
  const mySecret = useSecret(mine?.handle as Hex | undefined, c.prizePool);

  return (
    <Card label="The pool">
      {members === null ? (
        <p className="font-mono text-xs text-mist/50">reading the chain…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-mist">
          Nobody has deposited yet. The first stake will appear here — sealed.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {members.map((m) => {
            const isMine = m.address.toLowerCase() === address?.toLowerCase();
            return (
              <li
                key={m.address}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span
                  className={
                    "font-mono text-xs " +
                    (isMine ? "text-reveal" : "text-mist/70")
                  }
                >
                  {isMine ? "you" : shortAddress(m.address)}
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
        </ul>
      )}

      <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs leading-relaxed text-mist/60">
        Those are the actual ciphertexts stored on-chain, not placeholders. Only
        the holder of a stake can turn one into a number — the pool contract
        cannot read them either.
      </p>
    </Card>
  );
}
