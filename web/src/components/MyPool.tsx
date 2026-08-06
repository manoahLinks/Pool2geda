import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import type { Abi, Hex } from "viem";
import { Panel, Button, AmountField, Notice, Row, Secret } from "@/components/ui";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { useSecret } from "@/hooks/useSecret";
import { useTx } from "@/hooks/useTx";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { parseUnits } from "@/lib/format";
import { explainError } from "@/lib/errors";

const poolAbi = prizePoolAbi as unknown as Abi;

export function MyPool({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const sdk = useZamaSdk();
  const c = contracts!;

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<null | "encrypting" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const checkTx = useTx();
  const claimTx = useTx();

  const { data: epoch } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "epoch",
    query: { refetchInterval: 10_000 },
  });

  const lastClosed =
    epoch !== undefined && (epoch as bigint) > 0n ? (epoch as bigint) - 1n : null;

  const { data: draw } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "draws",
    args: lastClosed !== null ? [lastClosed] : undefined,
    query: { enabled: lastClosed !== null },
  });

  const { data: alreadyChecked, refetch: refetchChecked } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "checked",
    args: lastClosed !== null && address ? [lastClosed, address] : undefined,
    query: { enabled: lastClosed !== null && !!address },
  });

  const { data: winningsHandle, refetch: refetchWinnings } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "winningsOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: sharesHandle, refetch: refetchShares } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "sharesOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const winnings = useSecret(winningsHandle as Hex | undefined, c.prizePool);
  const shares = useSecret(sharesHandle as Hex | undefined, c.prizePool);

  const settled = (draw as { awarded?: boolean } | undefined)?.awarded === true;
  const canCheck = settled && !alreadyChecked;

  async function withdraw() {
    setError(null);
    if (!sdk || !walletClient || !publicClient || !address) {
      setError("Connect a wallet first.");
      return;
    }
    let value: bigint;
    try {
      value = parseUnits(amount);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    try {
      setBusy("encrypting");
      const { encryptedValues, inputProof } = await sdk.encrypt({
        values: [{ value, type: "euint64" }],
        contractAddress: c.prizePool,
        userAddress: address,
      });

      setBusy("sending");
      const hash = await walletClient.writeContract({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "withdraw",
        args: [encryptedValues[0], inputProof],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted.");

      setAmount("");
      shares.hide();
      await refetchShares();
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      step={5}
      tone="encrypted"
      title="Your position"
      subtitle="Only your wallet can turn these ciphertexts into numbers."
    >
      <Row label="Stake">
        <Secret value={shares.value} busy={shares.busy} onReveal={shares.reveal} emptyLabel="0" />
      </Row>
      <Row label="Winnings">
        <Secret
          value={winnings.value}
          busy={winnings.busy}
          onReveal={winnings.reveal}
          emptyLabel="0"
        />
      </Row>

      {lastClosed !== null && settled && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          {alreadyChecked ? (
            <p className="text-xs leading-relaxed text-white/50">
              You have checked round {lastClosed.toString()}. Decrypt your
              winnings above to see the result — the transaction itself gives
              nothing away, and costs the same whether you won or lost.
            </p>
          ) : (
            <>
              <Button
                busy={checkTx.busy}
                disabled={!canCheck}
                onClick={async () => {
                  if (
                    await checkTx.send({
                      address: c.prizePool,
                      abi: poolAbi,
                      functionName: "checkPrize",
                      args: [lastClosed],
                    })
                  ) {
                    winnings.hide();
                    await Promise.all([refetchChecked(), refetchWinnings()]);
                    onDone();
                  }
                }}
              >
                Check round {lastClosed.toString()}
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                Credits your prize if you won. The result is written encrypted —
                nobody learns the outcome, not even this contract.
              </p>
            </>
          )}
          {checkTx.error && <Notice kind="error">{checkTx.error}</Notice>}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="ghost"
          busy={claimTx.busy}
          onClick={async () => {
            if (
              await claimTx.send({
                address: c.prizePool,
                abi: poolAbi,
                functionName: "claim",
              })
            ) {
              winnings.hide();
              await refetchWinnings();
              onDone();
            }
          }}
        >
          Claim winnings
        </Button>
      </div>

      <div className="pt-1">
        <AmountField
          value={amount}
          onChange={setAmount}
          suffix="cUSD"
          disabled={busy !== null}
        />
        <div className="mt-2">
          <Button variant="ghost" busy={busy !== null} disabled={!amount} onClick={withdraw}>
            {busy === "encrypting"
              ? "Encrypting…"
              : busy === "sending"
                ? "Confirming…"
                : "Withdraw stake"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Withdraw any amount at any time, including mid-round. Principal never
          funds prizes, so you cannot lose it.
        </p>
      </div>

      {(error || claimTx.error || winnings.error || shares.error) && (
        <Notice kind="error">
          {error ?? claimTx.error ?? winnings.error ?? shares.error}
        </Notice>
      )}
    </Panel>
  );
}
