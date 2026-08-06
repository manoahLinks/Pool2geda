import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import type { Abi } from "viem";
import { Panel, Button, AmountField, Notice, Row } from "@/components/ui";
import { useTx } from "@/hooks/useTx";
import { useSecret } from "@/hooks/useSecret";
import { Secret } from "@/components/ui";
import { contracts } from "@/config/contracts";
import { testUsdAbi } from "@/abi/testUsd";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { formatUnits, parseUnits, secondsUntil, formatDuration } from "@/lib/format";

const usdAbi = testUsdAbi as unknown as Abi;
const cusdAbi = confidentialUsdAbi as unknown as Abi;

export function Faucet({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const c = contracts!;
  const tx = useTx();

  const { data: bal, refetch: refetchBal } = useReadContract({
    address: c.testUsd,
    abi: usdAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: nextAt, refetch: refetchNext } = useReadContract({
    address: c.testUsd,
    abi: usdAbi,
    functionName: "nextFaucetAt",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const cooldown = secondsUntil((nextAt as bigint) ?? 0n);

  return (
    <Panel
      step={1}
      title="Get tUSD"
      subtitle="A plain ERC-20. Public — everyone can see this balance."
    >
      <Row label="Your tUSD">
        <span className="font-mono text-lg">
          {bal !== undefined ? formatUnits(bal as bigint) : "…"}
        </span>
      </Row>
      <Button
        busy={tx.busy}
        disabled={cooldown > 0}
        onClick={async () => {
          if (await tx.send({ address: c.testUsd, abi: usdAbi, functionName: "faucet" })) {
            await Promise.all([refetchBal(), refetchNext()]);
            onDone();
          }
        }}
      >
        {cooldown > 0 ? `Cooldown ${formatDuration(cooldown)}` : "Claim 1,000 tUSD"}
      </Button>
      {tx.error && <Notice kind="error">{tx.error}</Notice>}
    </Panel>
  );
}

export function Wrap({ onDone }: { onDone: () => void }) {
  const { address } = useAccount();
  const c = contracts!;
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const approveTx = useTx();
  const wrapTx = useTx();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: c.testUsd,
    abi: usdAbi,
    functionName: "allowance",
    args: address ? [address, c.confidentialUsd] : undefined,
    query: { enabled: !!address },
  });

  const { data: cusdHandle, refetch: refetchCusd } = useReadContract({
    address: c.confidentialUsd,
    abi: cusdAbi,
    functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const secret = useSecret(cusdHandle as `0x${string}` | undefined, c.confidentialUsd);

  let parsed: bigint | null = null;
  try {
    parsed = amount ? parseUnits(amount) : null;
  } catch {
    parsed = null;
  }
  const needsApproval =
    parsed !== null && ((allowance as bigint) ?? 0n) < parsed;

  return (
    <Panel
      step={2}
      title="Wrap to cUSD"
      subtitle="The confidentiality boundary. This amount is public; everything after it is not."
    >
      <Row label="Your cUSD">
        <Secret
          value={secret.value}
          busy={secret.busy}
          onReveal={secret.reveal}
          emptyLabel="0"
        />
      </Row>

      <AmountField value={amount} onChange={setAmount} suffix="tUSD" />

      <div className="flex gap-2">
        <Button
          variant="ghost"
          busy={approveTx.busy}
          disabled={!needsApproval}
          onClick={async () => {
            setErr(null);
            try {
              const v = parseUnits(amount);
              if (
                await approveTx.send({
                  address: c.testUsd,
                  abi: usdAbi,
                  functionName: "approve",
                  args: [c.confidentialUsd, v],
                })
              ) {
                await refetchAllowance();
              }
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          {needsApproval ? "Approve" : "Approved"}
        </Button>

        <Button
          busy={wrapTx.busy}
          disabled={!parsed || needsApproval}
          onClick={async () => {
            setErr(null);
            try {
              const v = parseUnits(amount);
              if (
                await wrapTx.send({
                  address: c.confidentialUsd,
                  abi: cusdAbi,
                  functionName: "wrap",
                  args: [address!, v],
                })
              ) {
                setAmount("");
                secret.hide();
                await refetchCusd();
                onDone();
              }
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Wrap
        </Button>
      </div>

      {(err || approveTx.error || wrapTx.error || secret.error) && (
        <Notice kind="error">
          {err ?? approveTx.error ?? wrapTx.error ?? secret.error}
        </Notice>
      )}
    </Panel>
  );
}
