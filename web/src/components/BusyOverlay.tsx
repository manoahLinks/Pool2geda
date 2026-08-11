import { useEffect, useState } from "react";
import { Rosette } from "@/components/Rosette";
import { contracts } from "@/config/contracts";
import type { BusyKind } from "@/lib/shell";

/// What each wait is, in the user's terms.
///
/// `expected` is measured, not aspirational. The hardest of the three is
/// `proof`, because it runs before the wallet opens — there is no popup to
/// reassure anyone, so silence there reads as a broken app. That one gets the
/// fullest explanation.
const PLANS: Record<
  BusyKind,
  { title: string; body: string; foot: string; expected: number }
> = {
  proof: {
    title: "Encrypting in your browser",
    body: "Your amount is being encrypted on this device, with a zero-knowledge proof binding it to your address. The readable number never leaves the tab. Your wallet opens when it's ready.",
    foot: "Usually 10–14 seconds",
    expected: 12_000,
  },
  tx: {
    title: "Confirming onchain",
    body: "Transaction sent. Nothing else is needed from you.",
    foot: "Usually 12–30 seconds",
    expected: 20_000,
  },
  settle: {
    title: "Settling the round",
    body: "Decrypting the round's two public figures and proving them back to the contract. Anyone can run this step, and it reveals nothing about any individual.",
    foot: "A few seconds",
    expected: 8_000,
  },
};

/// Approach the end without ever claiming to have reached it. A bar that hits
/// 100% and sits there is worse than no bar, and these durations genuinely vary.
function progress(elapsed: number, expected: number): number {
  return 0.94 * (1 - Math.exp(-elapsed / (expected / 2.5)));
}

export function BusyOverlay({
  kind,
  startedAt,
}: {
  kind: BusyKind;
  startedAt: number;
}) {
  const plan = PLANS[kind];
  const [pct, setPct] = useState(0);

  useEffect(() => {
    setPct(0);
    const id = setInterval(
      () => setPct(progress(Date.now() - startedAt, plan.expected)),
      120
    );
    return () => clearInterval(id);
  }, [startedAt, plan.expected]);

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Working"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-bg/85 p-5 backdrop-blur-md"
    >
      <div className="pop w-[min(440px,100%)] rounded-card border border-line bg-surface p-8 text-center">
        <div className="mb-6 flex justify-center">
          <Rosette
            seed={contracts?.prizePool}
            size={72}
            spin
            className="text-accent-soft"
          />
        </div>
        <h2 className="m-0 text-[20px] font-extrabold">{plan.title}</h2>
        <p className="mx-auto m-0 mt-3 max-w-[42ch] text-[14px] leading-relaxed text-muted">
          {plan.body}
        </p>
        <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
        <div className="label mt-3">{plan.foot}</div>
      </div>
    </div>
  );
}
