import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import type { Abi } from "viem";
import { Card, Button, AmountField, Notice } from "@/components/ui";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { useTx } from "@/hooks/useTx";
import { contracts, OPERATOR_EXPIRY } from "@/config/contracts";
import { testUsdAbi } from "@/abi/testUsd";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { prizePoolAbi } from "@/abi/prizePool";
import { formatUnits, parseUnits, secondsUntil, formatDuration } from "@/lib/format";
import { explainError } from "@/lib/errors";

const usdAbi = testUsdAbi as unknown as Abi;
const cusdAbi = confidentialUsdAbi as unknown as Abi;
const poolAbi = prizePoolAbi as unknown as Abi;

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

function Step({
  n,
  title,
  done,
  open,
  onOpen,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-white/[0.06] first:border-t-0">
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span
          className={
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] " +
            (done
              ? "bg-reveal/15 text-reveal"
              : open
                ? "bg-seal text-white"
                : "bg-white/[0.06] text-mist/60")
          }
        >
          {done ? "✓" : n}
        </span>
        <span
          className={
            "text-sm " + (done && !open ? "text-mist/60" : "text-white/90")
          }
        >
          {title}
        </span>
      </button>
      {open && <div className="space-y-3 pb-4 pl-8">{children}</div>}
    </div>
  );
}

export function DepositFlow({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const sdk = useZamaSdk();
  const c = contracts!;

  const [wrapAmount, setWrapAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [manualStep, setManualStep] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "encrypting" | "sending">(null);
  const [error, setError] = useState<string | null>(null);

  const faucetTx = useTx();
  const approveTx = useTx();
  const wrapTx = useTx();
  const operatorTx = useTx();

  const { data: usdBal, refetch: refetchUsd } = useReadContract({
    address: c.testUsd, abi: usdAbi, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: nextFaucet, refetch: refetchFaucet } = useReadContract({
    address: c.testUsd, abi: usdAbi, functionName: "nextFaucetAt",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: c.testUsd, abi: usdAbi, functionName: "allowance",
    args: address ? [address, c.confidentialUsd] : undefined,
    query: { enabled: !!address },
  });
  const { data: cusdHandle, refetch: refetchCusd } = useReadContract({
    address: c.confidentialUsd, abi: cusdAbi, functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    address: c.confidentialUsd, abi: cusdAbi, functionName: "isOperator",
    args: address ? [address, c.prizePool] : undefined, query: { enabled: !!address },
  });

  const hasUsd = ((usdBal as bigint) ?? 0n) > 0n;
  // The private balance is encrypted, so we cannot know the amount — only
  // whether anything was ever wrapped. That is enough to route the flow, and
  // an over-deposit is caught by the saturating-transfer check on submit.
  const hasPrivate = !!cusdHandle && cusdHandle !== ZERO;
  const granted = isOperator === true;
  const cooldown = secondsUntil((nextFaucet as bigint) ?? 0n);

  const autoStep = !hasUsd && !hasPrivate ? 1 : !hasPrivate ? 2 : !granted ? 3 : 4;
  const step = manualStep ?? autoStep;

  let parsedWrap: bigint | null = null;
  try { parsedWrap = wrapAmount ? parseUnits(wrapAmount) : null; } catch { /* shown on submit */ }
  const needsApproval = parsedWrap !== null && ((allowance as bigint) ?? 0n) < parsedWrap;

  async function deposit() {
    setError(null);
    if (!sdk || !walletClient || !publicClient || !address) {
      setError("Connect a wallet first.");
      return;
    }
    let value: bigint;
    try { value = parseUnits(depositAmount); }
    catch (e) { setError((e as Error).message); return; }

    try {
      // Encrypted in the browser. The plaintext never leaves this tab — what
      // goes on-chain is a ciphertext plus a proof binding it to this contract
      // and this sender.
      setBusy("encrypting");
      const { encryptedValues, inputProof } = await sdk.encrypt({
        values: [{ value, type: "euint64" }],
        contractAddress: c.prizePool,
        userAddress: address,
      });

      setBusy("sending");
      const hash = await walletClient.writeContract({
        address: c.prizePool, abi: poolAbi, functionName: "deposit",
        args: [encryptedValues[0], inputProof],
        chain: walletClient.chain, account: walletClient.account!,
      });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted.");

      setDepositAmount("");
      onDone();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card label="Deposit">
      <div>
        <Step
          n={1} title="Get test tokens" done={hasUsd || hasPrivate}
          open={step === 1} onOpen={() => setManualStep(step === 1 ? null : 1)}
        >
          <p className="text-xs text-mist">
            tUSD is the pool's underlying token. Public — anyone can see this
            balance. You hold {formatUnits((usdBal as bigint) ?? 0n)}.
          </p>
          <Button
            busy={faucetTx.busy} disabled={cooldown > 0}
            onClick={async () => {
              if (await faucetTx.send({ address: c.testUsd, abi: usdAbi, functionName: "faucet" })) {
                await Promise.all([refetchUsd(), refetchFaucet()]);
                onDone();
              }
            }}
          >
            {cooldown > 0 ? `Again in ${formatDuration(cooldown)}` : "Get 1,000 tUSD"}
          </Button>
          {faucetTx.error && <Notice kind="error">{faucetTx.error}</Notice>}
        </Step>

        <Step
          n={2} title="Convert to a private balance" done={hasPrivate}
          open={step === 2} onOpen={() => setManualStep(step === 2 ? null : 2)}
        >
          <p className="text-xs text-mist">
            This is the last step anyone can see. The amount you convert is
            public; everything you do after it is not.
          </p>
          <AmountField value={wrapAmount} onChange={setWrapAmount} suffix="tUSD" />
          <div className="flex gap-2">
            <Button
              variant="ghost" busy={approveTx.busy} disabled={!needsApproval}
              onClick={async () => {
                try {
                  const v = parseUnits(wrapAmount);
                  if (await approveTx.send({
                    address: c.testUsd, abi: usdAbi, functionName: "approve",
                    args: [c.confidentialUsd, v],
                  })) await refetchAllowance();
                } catch (e) { setError((e as Error).message); }
              }}
            >
              {needsApproval ? "Approve" : "Approved"}
            </Button>
            <Button
              busy={wrapTx.busy} disabled={!parsedWrap || needsApproval}
              onClick={async () => {
                try {
                  const v = parseUnits(wrapAmount);
                  if (await wrapTx.send({
                    address: c.confidentialUsd, abi: cusdAbi, functionName: "wrap",
                    args: [address!, v],
                  })) {
                    setWrapAmount(""); setManualStep(null);
                    await Promise.all([refetchCusd(), refetchUsd()]);
                    onDone();
                  }
                } catch (e) { setError((e as Error).message); }
              }}
            >
              Convert
            </Button>
          </div>
          {(approveTx.error || wrapTx.error) && (
            <Notice kind="error">{approveTx.error ?? wrapTx.error}</Notice>
          )}
        </Step>

        <Step
          n={3} title="Allow the pool" done={granted}
          open={step === 3} onOpen={() => setManualStep(step === 3 ? null : 3)}
        >
          <p className="text-xs text-mist">
            A one-time permission, not an amount. The pool can only move what
            you explicitly deposit, and you can withdraw at any time.
          </p>
          <Button
            busy={operatorTx.busy}
            onClick={async () => {
              if (await operatorTx.send({
                address: c.confidentialUsd, abi: cusdAbi, functionName: "setOperator",
                args: [c.prizePool, BigInt(OPERATOR_EXPIRY)],
              })) { setManualStep(null); await refetchOperator(); onDone(); }
            }}
          >
            Allow
          </Button>
          {operatorTx.error && <Notice kind="error">{operatorTx.error}</Notice>}
        </Step>

        <Step
          n={4} title="Deposit into the pool" done={false}
          open={step === 4} onOpen={() => setManualStep(step === 4 ? null : 4)}
        >
          <AmountField
            value={depositAmount} onChange={setDepositAmount}
            suffix="private" disabled={busy !== null}
          />
          <Button busy={busy !== null} disabled={!depositAmount} onClick={deposit}>
            {busy === "encrypting" ? "Encrypting…" : busy === "sending" ? "Confirming…" : "Deposit"}
          </Button>
          {busy === "encrypting" && (
            <Notice>
              Building the zero-knowledge proof in your browser. Around ten
              seconds — nothing leaves this tab until it is encrypted.
            </Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </Step>
      </div>
    </Card>
  );
}
