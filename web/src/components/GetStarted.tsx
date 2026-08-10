import { useState } from "react";
import { useAccount } from "wagmi";
import type { Abi } from "viem";
import { AmountInput, Badge, Button, Card } from "@/components/ui";
import { useWrite } from "@/hooks/useWrite";
import type { useSetup } from "@/hooks/useSetup";
import { contracts, OPERATOR_EXPIRY } from "@/config/contracts";
import { testUsdAbi } from "@/abi/testUsd";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { formatMoney, parseUnits, formatDuration } from "@/lib/format";
import { useShell } from "@/lib/shell";

const usdAbi = testUsdAbi as unknown as Abi;
const cusdAbi = confidentialUsdAbi as unknown as Abi;

/// Three transactions stand between a new wallet and its first deposit.
///
/// Shown as a checklist rather than a wizard: every step is visible at once,
/// each ticks off as the chain confirms it, and the whole card disappears when
/// setup is done. A wizard hides how much is left, which is exactly the anxiety
/// that makes people abandon onboarding.
export function GetStarted({
  setup,
  onDone,
}: {
  setup: ReturnType<typeof useSetup>;
  onDone: () => void;
}) {
  const c = contracts!;
  const { address } = useAccount();
  const { run, notify } = useShell();
  const write = useWrite();
  const [wrapAmount, setWrapAmount] = useState("");

  const cooldown = setup.cooldown;

  async function faucet() {
    const ok = await run("tx", () =>
      write({ address: c.testUsd, abi: usdAbi, functionName: "faucet" })
    );
    if (ok) {
      await setup.refetchAll();
      onDone();
    }
  }

  async function wrap() {
    let v: bigint;
    try {
      v = parseUnits(wrapAmount);
    } catch (e) {
      notify({ tone: "bad", title: "Check the amount", body: (e as Error).message });
      return;
    }
    if (setup.allowance < v) {
      const approved = await run("tx", () =>
        write({
          address: c.testUsd,
          abi: usdAbi,
          functionName: "approve",
          args: [c.confidentialUsd, v],
        })
      );
      if (!approved) return;
    }
    const ok = await run("tx", () =>
      write({
        address: c.confidentialUsd,
        abi: cusdAbi,
        functionName: "wrap",
        args: [address!, v],
      })
    );
    if (ok) {
      setWrapAmount("");
      await setup.refetchAll();
      onDone();
    }
  }

  async function allow() {
    const ok = await run("tx", () =>
      write({
        address: c.confidentialUsd,
        abi: cusdAbi,
        functionName: "setOperator",
        args: [c.prizePool, BigInt(OPERATOR_EXPIRY)],
      })
    );
    if (ok) {
      await setup.refetchAll();
      onDone();
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="m-0 text-[18px] font-extrabold">Get started</h2>
        <Badge tone="accent">
          {[setup.done.faucet, setup.done.convert, setup.done.allow].filter(Boolean).length}/3
        </Badge>
      </div>
      <p className="m-0 mb-6 text-[14px] text-muted">
        Three one-off steps. Free test money, then a private balance the pool can
        draw a deposit from.
      </p>

      <Step
        n={1}
        title="Get test tokens"
        body="This is a test network, so the money is free and worth nothing. The tap gives 1,000 tUSD an hour."
        done={setup.done.faucet}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={faucet} disabled={cooldown > 0}>
            {cooldown > 0 ? `Wait ${formatDuration(cooldown)}` : "Get 1,000 tUSD"}
          </Button>
          <span className="text-[13px] text-muted">
            Balance {formatMoney(setup.balance)} tUSD
          </span>
        </div>
      </Step>

      <Step
        n={2}
        title="Make it private"
        body="Swaps public tUSD for confidential cUSD. The amount you swap is the last number about you anyone can read — everything after this is encrypted."
        done={setup.done.convert}
      >
        <div className="max-w-[340px]">
          <AmountInput
            label="Amount to make private"
            value={wrapAmount}
            onChange={setWrapAmount}
            unit="tUSD"
            onMax={() => setWrapAmount(formatMoney(setup.balance).replace(/,/g, ""))}
            hint={
              <>
                <span>Available</span>
                <span className="font-bold text-text">
                  {formatMoney(setup.balance)} tUSD
                </span>
              </>
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={wrap} disabled={!wrapAmount.trim()}>
            Make private
          </Button>
          <span className="text-[13px] text-muted">Two confirmations</span>
        </div>
      </Step>

      <Step
        n={3}
        title="Allow the pool"
        body="Lets the pool move confidential tokens on your behalf when you deposit. It still cannot read your balance, you can withdraw everything at any time, and this is revocable."
        done={setup.done.allow}
        last
      >
        <Button size="sm" onClick={allow}>
          Allow the pool
        </Button>
      </Step>
    </Card>
  );
}

function Step({
  n,
  title,
  body,
  done,
  children,
  last,
}: {
  n: number;
  title: string;
  body: string;
  done: boolean;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "" : "mb-5 border-b border-line pb-5"}>
      <div className="flex gap-4">
        <div
          className={
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold " +
            (done ? "bg-mint text-bg" : "bg-surface-2 text-muted")
          }
        >
          {done ? "✓" : n}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3
              className={
                "m-0 text-[15px] font-bold " + (done ? "text-muted line-through" : "")
              }
            >
              {title}
            </h3>
          </div>
          {!done && (
            <>
              <p className="m-0 mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-muted">
                {body}
              </p>
              <div className="mt-4">{children}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
