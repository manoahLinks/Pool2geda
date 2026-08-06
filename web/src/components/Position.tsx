import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import type { Abi, Hex } from "viem";
import { Card, Button, AmountField, Notice, Sealed, Stat } from "@/components/ui";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { useSecret } from "@/hooks/useSecret";
import { useTx } from "@/hooks/useTx";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { parseUnits } from "@/lib/format";
import { explainError } from "@/lib/errors";

const poolAbi = prizePoolAbi as unknown as Abi;

export function Position({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const sdk = useZamaSdk();
  const c = contracts!;

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<null | "encrypting" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const claimTx = useTx();

  const { data: sharesHandle, refetch: refetchShares } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "sharesOf",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: winningsHandle, refetch: refetchWinnings } = useReadContract({
    address: c.prizePool, abi: poolAbi, functionName: "winningsOf",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });

  const shares = useSecret(sharesHandle as Hex | undefined, c.prizePool);
  const winnings = useSecret(winningsHandle as Hex | undefined, c.prizePool);

  async function withdraw() {
    setError(null);
    if (!sdk || !walletClient || !publicClient || !address) {
      setError("Connect a wallet first.");
      return;
    }
    let value: bigint;
    try { value = parseUnits(amount); }
    catch (e) { setError((e as Error).message); return; }

    try {
      setBusy("encrypting");
      const { encryptedValues, inputProof } = await sdk.encrypt({
        values: [{ value, type: "euint64" }],
        contractAddress: c.prizePool,
        userAddress: address,
      });
      setBusy("sending");
      const hash = await walletClient.writeContract({
        address: c.prizePool, abi: poolAbi, functionName: "withdraw",
        args: [encryptedValues[0], inputProof],
        chain: walletClient.chain, account: walletClient.account!,
      });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted.");
      setAmount(""); shares.hide(); await refetchShares(); onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card label="Yours">
      <div className="grid grid-cols-2 gap-5">
        <Stat label="Stake">
          <Sealed
            handle={sharesHandle as string | undefined}
            value={shares.value} busy={shares.busy} onReveal={shares.reveal}
          />
        </Stat>
        <Stat label="Winnings">
          <Sealed
            handle={winningsHandle as string | undefined}
            value={winnings.value} busy={winnings.busy} onReveal={winnings.reveal}
          />
        </Stat>
      </div>

      <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
        <AmountField
          value={amount} onChange={setAmount}
          suffix="private" disabled={busy !== null}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" busy={busy !== null} disabled={!amount} onClick={withdraw}>
            {busy === "encrypting" ? "Encrypting…" : busy === "sending" ? "Confirming…" : "Withdraw"}
          </Button>
          <Button
            variant="ghost" busy={claimTx.busy}
            onClick={async () => {
              if (await claimTx.send({
                address: c.prizePool, abi: poolAbi, functionName: "claim",
              })) { winnings.hide(); await refetchWinnings(); onDone(); }
            }}
          >
            Move winnings out
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-mist/60">
          Take out any amount, any time — including mid-round. Prizes are paid
          from a separate reserve, so your deposit is never at risk.
        </p>
      </div>

      {(error || claimTx.error || shares.error || winnings.error) && (
        <div className="mt-3">
          <Notice kind="error">
            {error ?? claimTx.error ?? shares.error ?? winnings.error}
          </Notice>
        </div>
      )}
    </Card>
  );
}
