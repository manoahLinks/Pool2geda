import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import type { Abi, Hex } from "viem";
import { Panel, Button, AmountField, Notice, Row, Secret } from "@/components/ui";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { useSecret } from "@/hooks/useSecret";
import { useTx } from "@/hooks/useTx";
import { contracts, OPERATOR_EXPIRY } from "@/config/contracts";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { prizePoolAbi } from "@/abi/prizePool";
import { parseUnits } from "@/lib/format";
import { explainError } from "@/lib/errors";

const cusdAbi = confidentialUsdAbi as unknown as Abi;
const poolAbi = prizePoolAbi as unknown as Abi;

export function Deposit({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const sdk = useZamaSdk();
  const c = contracts!;

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<null | "encrypting" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const operatorTx = useTx();

  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    address: c.confidentialUsd,
    abi: cusdAbi,
    functionName: "isOperator",
    args: address ? [address, c.prizePool] : undefined,
    query: { enabled: !!address },
  });

  const { data: sharesHandle, refetch: refetchShares } = useReadContract({
    address: c.prizePool,
    abi: poolAbi,
    functionName: "sharesOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const shares = useSecret(sharesHandle as Hex | undefined, c.prizePool);

  async function submit() {
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
      // Encrypt client-side. The plaintext never leaves the browser — what goes
      // on-chain is a ciphertext handle plus a zero-knowledge proof binding it
      // to this contract AND this sender. Takes ~10s.
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
        functionName: "deposit",
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
      step={3}
      tone="encrypted"
      title="Deposit"
      subtitle="Encrypted in your browser before it is sent. Nobody — including this app — learns the amount."
    >
      <Row label="Your stake">
        <Secret
          value={shares.value}
          busy={shares.busy}
          onReveal={shares.reveal}
          emptyLabel="0"
        />
      </Row>

      {!isOperator ? (
        <>
          <Notice kind="info">
            The pool needs permission to move your cUSD. This is a one-time
            grant, not an amount — it cannot take more than you deposit.
          </Notice>
          <Button
            busy={operatorTx.busy}
            onClick={async () => {
              if (
                await operatorTx.send({
                  address: c.confidentialUsd,
                  abi: cusdAbi,
                  functionName: "setOperator",
                  args: [c.prizePool, BigInt(OPERATOR_EXPIRY)],
                })
              ) {
                await refetchOperator();
              }
            }}
          >
            Grant access
          </Button>
          {operatorTx.error && <Notice kind="error">{operatorTx.error}</Notice>}
        </>
      ) : (
        <>
          <AmountField
            value={amount}
            onChange={setAmount}
            suffix="cUSD"
            disabled={busy !== null}
          />
          <Button busy={busy !== null} disabled={!amount} onClick={submit}>
            {busy === "encrypting"
              ? "Encrypting…"
              : busy === "sending"
                ? "Confirming…"
                : "Deposit"}
          </Button>
          {busy === "encrypting" && (
            <Notice kind="info">
              Generating the zero-knowledge proof. This takes about ten seconds
              and runs entirely in your browser.
            </Notice>
          )}
        </>
      )}

      {(error || shares.error) && (
        <Notice kind="error">{error ?? shares.error}</Notice>
      )}
    </Panel>
  );
}
