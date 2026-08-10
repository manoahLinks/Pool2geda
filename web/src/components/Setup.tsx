import { useState } from "react";
import { useAccount } from "wagmi";
import type { Abi } from "viem";
import { AmountField, Button, Label } from "@/components/ui";
import { useWrite, useEncrypt } from "@/hooks/useWrite";
import { SETUP_ORDER, type SetupStep, type useSetup } from "@/hooks/useSetup";
import { contracts, OPERATOR_EXPIRY } from "@/config/contracts";
import { testUsdAbi } from "@/abi/testUsd";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { prizePoolAbi } from "@/abi/prizePool";
import { formatMoney, parseUnits, formatDuration } from "@/lib/format";
import { useShell } from "@/lib/shell";

const usdAbi = testUsdAbi as unknown as Abi;
const cusdAbi = confidentialUsdAbi as unknown as Abi;
const poolAbi = prizePoolAbi as unknown as Abi;

type Copy = {
  title: string;
  body: string;
  cta: string;
  foot: string;
  amount: boolean;
  unit?: string;
};

/// Four transactions stand between a new saver and their first deposit, and
/// every one of them is somewhere to give up. So: one step on screen at a time,
/// in the plainest language the facts allow, with the count always visible.
///
/// Nothing here overstates the protections. Step three genuinely hands the pool
/// the ability to move your private tokens — that is what an operator grant is
/// — so it says so, and says it is reversible, rather than claiming the pool
/// "cannot touch" anything.
const COPY: Record<SetupStep, Copy> = {
  faucet: {
    title: "Collect test money",
    body: "This runs on a test network, so the money is free and worth nothing. The tap gives 1,000 test USD an hour.",
    cta: "Collect 1,000",
    foot: "One confirmation.",
    amount: false,
  },
  convert: {
    title: "Cross into private",
    body: "This exchanges ordinary tokens for private ones. The sum you exchange is the last number about you that anyone can read. Everything after this point is sealed.",
    cta: "Make it private",
    foot: "Two confirmations — an approval, then the exchange.",
    amount: true,
    unit: "test USD",
  },
  allow: {
    title: "Let the pool take a deposit",
    body: "A one-off permission letting the pool move private tokens on your behalf when you deposit. It still cannot read your balance, you can withdraw everything at any time, and you can revoke this later.",
    cta: "Grant permission",
    foot: "One confirmation.",
    amount: false,
  },
  deposit: {
    title: "Seal it into the pool",
    body: "Your amount is encrypted on this device, with a proof binding it to your address, before anything is sent. The readable number never leaves the tab. Expect about ten seconds of work before your wallet opens.",
    cta: "Deposit",
    foot: "Withdrawable at any hour, in full.",
    amount: true,
    unit: "private USD",
  },
};

export function Setup({
  setup,
  step,
  onDeposited,
  onCancel,
}: {
  setup: ReturnType<typeof useSetup>;
  step: SetupStep;
  onDeposited: () => void;
  /// Present only when an established saver came here to add more, so they can
  /// get back without depositing.
  onCancel?: () => void;
}) {
  const c = contracts!;
  const { address } = useAccount();
  const { run, notify } = useShell();
  const write = useWrite();
  const encrypt = useEncrypt();
  const [amount, setAmount] = useState("");

  const copy = COPY[step];
  const index = SETUP_ORDER.indexOf(step) + 1;
  const onCooldown = step === "faucet" && setup.cooldown > 0;

  /// Reject a bad amount before anything is signed, so a typo can never become
  /// a different number on-chain.
  function parse(): bigint | null {
    try {
      return parseUnits(amount);
    } catch (e) {
      notify({ tone: "bad", title: "Check the amount", body: (e as Error).message });
      return null;
    }
  }

  async function faucet() {
    const ok = await run("tx", () =>
      write({ address: c.testUsd, abi: usdAbi, functionName: "faucet" })
    );
    if (ok) await setup.refetchAll();
  }

  async function convert() {
    const v = parse();
    if (v === null) return;

    // Approve only when the existing allowance is short — a saver returning to
    // top up should not have to sign twice for nothing.
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
      setAmount("");
      await setup.refetchAll();
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
    if (ok) await setup.refetchAll();
  }

  async function deposit() {
    const v = parse();
    if (v === null) return;

    const enc = await run("proof", () => encrypt(v, c.prizePool));
    if (!enc) return;

    const ok = await run("tx", () =>
      write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: "deposit",
        args: [enc.handle, enc.proof],
      })
    );
    if (!ok) return;

    setAmount("");
    await setup.refetchAll();
    onDeposited();
  }

  const action =
    step === "faucet"
      ? faucet
      : step === "convert"
        ? convert
        : step === "allow"
          ? allow
          : deposit;

  const completed = SETUP_ORDER.filter((k) => setup.done[k]);

  return (
    <div className="stagger max-w-[640px] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <Label>{onCancel ? "Adding to your holding" : `Step ${index} of 4`}</Label>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="label cursor-pointer border-none bg-transparent p-0 text-slate underline underline-offset-4 decoration-line transition-colors hover:text-ink hover:decoration-ink"
          >
            Back to your holding
          </button>
        )}
      </div>

      {/* Four segments, filling left to right. A real measure of a real
          sequence — the one place in this design where numbering earns itself. */}
      {!onCancel && (
        <div className="mt-4 flex max-w-[380px] gap-1">
          {SETUP_ORDER.map((k) => (
            <span
              key={k}
              className={
                "h-[3px] flex-1 transition-colors duration-300 " +
                (setup.done[k] ? "bg-ink" : k === step ? "bg-slate" : "bg-line")
              }
            />
          ))}
        </div>
      )}

      <h1 className="wide m-0 mt-9 text-[clamp(32px,5vw,46px)] leading-[1.02] font-bold">
        {copy.title}
      </h1>
      <p className="m-0 mt-5 max-w-[52ch] text-[16px] leading-[1.65] text-slate">
        {copy.body}
      </p>

      {copy.amount && (
        <div className="mt-10 max-w-[420px]">
          <AmountField
            label={step === "convert" ? "Amount to make private" : "Amount to deposit"}
            value={amount}
            onChange={setAmount}
            unit={copy.unit!}
            hint={
              step === "convert"
                ? `Holding ${formatMoney(setup.balance)} test USD`
                : "Drawn from your private balance"
            }
          />
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-6">
        <Button
          size="lg"
          onClick={action}
          disabled={onCooldown || (copy.amount && !amount.trim())}
        >
          {onCooldown ? `Available in ${formatDuration(setup.cooldown)}` : copy.cta}
        </Button>
        <span className="text-[14px] text-slate">
          {onCooldown ? "The tap gives 1,000 test USD an hour." : copy.foot}
        </span>
      </div>

      {completed.length > 0 && !onCancel && (
        <div className="mt-16 border-t border-line pt-6">
          <Label>Done</Label>
          <ul className="m-0 mt-4 list-none p-0">
            {completed.map((k) => (
              <li
                key={k}
                className="flex items-baseline gap-3 py-1.5 text-[14px] text-slate"
              >
                <span className="text-ink">—</span>
                {COPY[k].title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
