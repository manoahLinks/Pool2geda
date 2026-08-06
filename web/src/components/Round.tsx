import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import type { Abi, Hex } from "viem";
import { Card, Button, Notice } from "@/components/ui";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { useTx } from "@/hooks/useTx";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { publicDecryptWithRetry } from "@/lib/decrypt";
import { secondsUntil } from "@/lib/format";
import { explainError } from "@/lib/errors";

const poolAbi = prizePoolAbi as unknown as Abi;

type Draw = {
  totalCumulative: bigint;
  randomness: bigint;
  prize: bigint;
  awarded: boolean;
};

/// Anyone can run a round. The schedule is fixed on-chain, so whoever calls it
/// cannot pick a favourable moment — and the randomness is drawn by the
/// coprocessor inside the closing transaction, so it cannot be resampled.
export function Round({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const sdk = useZamaSdk();
  const c = contracts!;

  const [busy, setBusy] = useState<null | "decrypting" | "awarding">(null);
  const [error, setError] = useState<string | null>(null);
  const closeTx = useTx();
  const checkTx = useTx();

  const { data: epoch, refetch: refetchEpoch } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "epoch",
    query: { refetchInterval: 10_000 },
  });
  const { data: endsAt, refetch: refetchEnds } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "epochEndsAt",
    query: { refetchInterval: 10_000 },
  });

  const last = epoch !== undefined && (epoch as bigint) > 0n ? (epoch as bigint) - 1n : null;

  const { data: drawRaw, refetch: refetchDraw } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "draws",
    args: last !== null ? [last] : undefined, query: { enabled: last !== null },
  });
  const { data: alreadyChecked, refetch: refetchChecked } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "checked",
    args: last !== null && address ? [last, address] : undefined,
    query: { enabled: last !== null && !!address },
  });

  const draw = drawRaw as unknown as Draw | undefined;
  const expired = secondsUntil((endsAt as bigint) ?? 0n) === 0;

  async function settle() {
    setError(null);
    if (last === null || !sdk || !walletClient || !publicClient) return;
    try {
      const [totalHandle, randHandle] = (await Promise.all([
        publicClient.readContract({
          address: c.prizePool, abi: poolAbi,
          functionName: "pendingTotalHandle", args: [last],
        }),
        publicClient.readContract({
          address: c.prizePool, abi: poolAbi,
          functionName: "pendingRandomHandle", args: [last],
        }),
      ])) as [Hex, Hex];

      // Order is bound into the proof and must match the contract's cts array.
      setBusy("decrypting");
      const res = await publicDecryptWithRetry(sdk, [totalHandle, randHandle]);

      setBusy("awarding");
      const hash = await walletClient.writeContract({
        address: c.prizePool, abi: poolAbi, functionName: "awardDraw",
        args: [last, res.cleartexts, res.decryptionProof],
        chain: walletClient.chain, account: walletClient.account!,
      });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted.");
      await Promise.all([refetchDraw(), refetchEpoch()]);
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card label={`Round ${epoch?.toString() ?? "—"}`}>
      <div className="space-y-3">
        {!expired ? (
          <p className="text-sm text-mist">
            This round is still running. When the timer runs out, anyone can
            close it.
          </p>
        ) : (
          <>
            <p className="text-sm text-mist">Time is up. Close it to draw.</p>
            <Button
              busy={closeTx.busy}
              onClick={async () => {
                if (await closeTx.send({
                  address: c.prizePool, abi: poolAbi, functionName: "closeEpoch",
                })) {
                  await Promise.all([refetchEpoch(), refetchEnds(), refetchDraw()]);
                  onDone();
                }
              }}
            >
              Close the round
            </Button>
          </>
        )}

        {last !== null && draw && !draw.awarded && (
          <div className="rounded-xl border border-seal/25 bg-seal/[0.07] p-3.5">
            <p className="text-xs leading-relaxed text-mist">
              Round {last.toString()} is closed but not settled. Settling fetches
              the decrypted round total and its randomness, then proves both to
              the contract.
            </p>
            <div className="mt-3">
              <Button busy={busy !== null} onClick={settle}>
                {busy === "decrypting" ? "Decrypting…" : busy === "awarding" ? "Proving…" : "Settle"}
              </Button>
            </div>
          </div>
        )}

        {last !== null && draw?.awarded && (
          <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3.5">
            {alreadyChecked ? (
              <p className="text-xs leading-relaxed text-mist">
                You checked round {last.toString()}. Decrypt your winnings to see
                how it went — the transaction gives nothing away, and costs the
                same whether you won or not.
              </p>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-mist">
                  Round {last.toString()} is settled. Find out how you did.
                </p>
                <div className="mt-3">
                  <Button
                    busy={checkTx.busy}
                    onClick={async () => {
                      if (await checkTx.send({
                        address: c.prizePool, abi: poolAbi,
                        functionName: "checkPrize", args: [last],
                      })) {
                        await Promise.all([refetchChecked(), refetchDraw()]);
                        onDone();
                      }
                    }}
                  >
                    Check round {last.toString()}
                  </Button>
                </div>
              </>
            )}
            {checkTx.error && (
              <div className="mt-3"><Notice kind="error">{checkTx.error}</Notice></div>
            )}
          </div>
        )}

        {(error || closeTx.error) && (
          <Notice kind="error">{error ?? closeTx.error}</Notice>
        )}
      </div>
    </Card>
  );
}
