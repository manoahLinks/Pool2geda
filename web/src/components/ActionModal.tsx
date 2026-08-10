import { useState } from "react";
import type { Abi } from "viem";
import { AmountInput, Button, Modal, Row, Segments } from "@/components/ui";
import { useWrite, useEncrypt } from "@/hooks/useWrite";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { formatMoney, parseUnits } from "@/lib/format";
import { SATURATED_TRANSFER } from "@/lib/errors";
import { useShell } from "@/lib/shell";

const poolAbi = prizePoolAbi as unknown as Abi;

export type Action = "deposit" | "withdraw";

/// Deposit and withdraw in one dialog, switched by a segmented control — the
/// arrangement every DeFi front end uses, because it puts the reverse of what
/// you are doing one click away rather than one page away.
export function ActionModal({
  action,
  onAction,
  onClose,
  onDone,
  /// Decrypted stake, when the user has unsealed it. Enables MAX and lets us
  /// catch a saturating withdrawal before anything is signed.
  knownStake,
}: {
  action: Action;
  onAction: (a: Action) => void;
  onClose: () => void;
  onDone: () => void;
  knownStake: bigint | null;
}) {
  const c = contracts!;
  const { run, notify } = useShell();
  const write = useWrite();
  const encrypt = useEncrypt();
  const [amount, setAmount] = useState("");

  const depositing = action === "deposit";

  async function submit() {
    let v: bigint;
    try {
      v = parseUnits(amount);
    } catch (e) {
      notify({ tone: "bad", title: "Check the amount", body: (e as Error).message });
      return;
    }

    // The one case where a silent no-op is preventable rather than only
    // explainable: the stake is already decrypted, so we can compare first.
    if (!depositing && knownStake !== null && v > knownStake) {
      notify({ tone: "bad", ...SATURATED_TRANSFER });
      return;
    }

    const enc = await run("proof", () => encrypt(v, c.prizePool));
    if (!enc) return;

    const ok = await run("tx", () =>
      write({
        address: c.prizePool,
        abi: poolAbi,
        functionName: depositing ? "deposit" : "withdraw",
        args: [enc.handle, enc.proof],
      })
    );
    if (!ok) return;

    setAmount("");
    onClose();
    onDone();
    notify({
      tone: "good",
      title: depositing ? "Deposited" : "Withdrawn",
      body: depositing
        ? "Your deposit is encrypted onchain and already earning odds. Decrypt your balance to confirm the amount."
        : "Your tokens are back in your private balance. Figures re-locked because they changed — decrypt to read the new ones.",
    });
  }

  return (
    <Modal
      title={depositing ? "Deposit" : "Withdraw"}
      subtitle="Confidential prize pool · Sepolia"
      onClose={onClose}
    >
      <Segments
        value={action}
        onChange={onAction}
        options={[
          { value: "deposit", label: "Deposit" },
          { value: "withdraw", label: "Withdraw" },
        ]}
      />

      <div className="mt-5">
        <AmountInput
          label={depositing ? "Amount to deposit" : "Amount to withdraw"}
          value={amount}
          onChange={setAmount}
          unit="cUSD"
          onMax={
            !depositing && knownStake !== null
              ? () => setAmount(formatMoney(knownStake).replace(/,/g, ""))
              : undefined
          }
          hint={
            <>
              <span>{depositing ? "From your private balance" : "Your deposit"}</span>
              <span className="font-bold text-text">
                {knownStake !== null && !depositing
                  ? `${formatMoney(knownStake)} cUSD`
                  : "Encrypted"}
              </span>
            </>
          }
        />
      </div>

      <div className="mt-5 rounded-ctl border border-line bg-bg px-4 py-2">
        <Row k="Network" v="Sepolia" />
        <Row k={depositing ? "Odds start" : "Principal"} v={depositing ? "Immediately" : "Always yours"} />
        <Row
          k="Visible onchain"
          v={<span className="text-mint">Nothing but that you acted</span>}
        />
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        {depositing
          ? "Your amount is encrypted in this browser, with a proof binding it to your address, before anything is sent. Expect about ten seconds of work before your wallet opens."
          : "Withdraw any amount at any time, including mid-round. Prizes come from a separate reserve, so your deposit is never at risk."}
      </p>

      <div className="mt-6">
        <Button full size="lg" onClick={submit} disabled={!amount.trim()}>
          {depositing ? "Deposit" : "Withdraw"}
        </Button>
      </div>
    </Modal>
  );
}
