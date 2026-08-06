import { useEffect, useState } from "react";
import { usePublicClient, useReadContract, useWalletClient } from "wagmi";
import type { Abi, Hex } from "viem";
import { Panel, Button, Notice, Row } from "@/components/ui";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { useTx } from "@/hooks/useTx";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { publicDecryptWithRetry } from "@/lib/decrypt";
import { formatUnits, secondsUntil, formatDuration } from "@/lib/format";
import { explainError } from "@/lib/errors";

const poolAbi = prizePoolAbi as unknown as Abi;

type Draw = {
  totalCumulative: bigint;
  randomness: bigint;
  prize: bigint;
  awarded: boolean;
};

export function DrawPanel({ onDone }: { onDone: () => void }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const sdk = useZamaSdk();
  const c = contracts!;

  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<null | "decrypting" | "awarding">(null);
  const [error, setError] = useState<string | null>(null);
  const closeTx = useTx();

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: epoch, refetch: refetchEpoch } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "epoch",
    query: { refetchInterval: 10_000 },
  });

  const { data: endsAt, refetch: refetchEnds } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "epochEndsAt",
    query: { refetchInterval: 10_000 },
  });

  // The most recently closed epoch is the one that can still be settled.
  const lastClosed = epoch !== undefined && (epoch as bigint) > 0n ? (epoch as bigint) - 1n : null;

  const { data: lastDraw, refetch: refetchDraw } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "draws",
    args: lastClosed !== null ? [lastClosed] : undefined,
    query: { enabled: lastClosed !== null },
  });

  const draw = lastDraw as unknown as Draw | undefined;
  const remaining = secondsUntil((endsAt as bigint) ?? 0n);
  const expired = remaining === 0;

  async function settle() {
    setError(null);
    if (lastClosed === null) return;
    if (!sdk || !walletClient || !publicClient) {
      setError("Connect a wallet first.");
      return;
    }
    try {
      const [totalHandle, randHandle] = (await Promise.all([
        publicClient.readContract({
          address: c.prizePool,
          abi: poolAbi,
          functionName: "pendingTotalHandle",
          args: [lastClosed],
        }),
        publicClient.readContract({
          address: c.prizePool,
          abi: poolAbi,
          functionName: "pendingRandomHandle",
          args: [lastClosed],
        }),
      ])) as [Hex, Hex];

      // Handle order is bound into the proof and must match the contract's
      // `cts` array. Retries because the ciphertext needs to propagate to the
      // gateway before the relayer will answer.
      setBusy("decrypting");
      const res = await publicDecryptWithRetry(sdk, [totalHandle, randHandle]);

      setBusy("awarding");
      const hash = await walletClient.writeContract({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "awardDraw",
        args: [lastClosed, res.cleartexts, res.decryptionProof],
        chain: walletClient.chain,
        account: walletClient.account!,
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
    <Panel
      step={4}
      title="The draw"
      subtitle="Anyone can run these — the schedule is fixed on-chain, so timing cannot be gamed."
    >
      <Row label="Round">
        <span className="font-mono text-lg">{epoch?.toString() ?? "…"}</span>
      </Row>
      <Row label={expired ? "Ready to close" : "Closes in"}>
        <span className="font-mono text-lg" key={tick}>
          {endsAt !== undefined ? formatDuration(remaining) : "…"}
        </span>
      </Row>

      <Button
        busy={closeTx.busy}
        disabled={!expired}
        onClick={async () => {
          if (
            await closeTx.send({
              address: c.prizePool,
              abi: poolAbi,
              functionName: "closeEpoch",
            })
          ) {
            await Promise.all([refetchEpoch(), refetchEnds(), refetchDraw()]);
            onDone();
          }
        }}
      >
        Close round
      </Button>

      {lastClosed !== null && draw && (
        <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <Row label={`Round ${lastClosed} status`}>
            <span className="text-sm">
              {draw.awarded ? "settled" : "awaiting settlement"}
            </span>
          </Row>

          {draw.awarded ? (
            <>
              <Row label="Total stake-time (public)">
                <span className="font-mono text-sm">
                  {draw.totalCumulative.toString()}
                </span>
              </Row>
              <Row label="Prize">
                <span className="font-mono text-sm">
                  {formatUnits(draw.prize)} cUSD
                </span>
              </Row>
              <p className="pt-1 text-[11px] leading-relaxed text-white/40">
                The randomness and the pool total are public. Individual stakes
                are not — so knowing both still tells you nothing about who won.
              </p>
            </>
          ) : (
            <>
              <Button busy={busy !== null} onClick={settle}>
                {busy === "decrypting"
                  ? "Decrypting draw…"
                  : busy === "awarding"
                    ? "Verifying proof…"
                    : "Settle round"}
              </Button>
              <p className="text-[11px] leading-relaxed text-white/40">
                Fetches the KMS decryption of the round total and its randomness,
                then submits both with a proof the contract verifies on-chain.
              </p>
            </>
          )}
        </div>
      )}

      {(error || closeTx.error) && (
        <Notice kind="error">{error ?? closeTx.error}</Notice>
      )}
    </Panel>
  );
}
