import { useEffect, useState } from "react";
import { Rosette } from "@/components/Rosette";
import { contracts } from "@/config/contracts";
import type { BusyKind } from "@/lib/shell";

/// What each wait is, in the saver's terms.
///
/// `expected` is the honest measured duration, not a target: the browser proof
/// really does take 10–14 seconds, and Sepolia really does take 12–30. The
/// hardest of the three is `proof`, because it runs before the wallet opens —
/// there is no popup to reassure anyone, so silence there reads as a broken
/// app. That wait gets the fullest explanation.
const PLANS: Record<
  BusyKind,
  { title: string; body: string; foot: string; expected: number }
> = {
  proof: {
    title: "Encrypting on this device",
    body: "Your amount is being sealed here, in this tab, together with a proof binding it to your address. The readable number never leaves the machine. Your wallet opens once it is ready.",
    foot: "Typically 10–14 seconds",
    expected: 12_000,
  },
  tx: {
    title: "Waiting on the network",
    body: "Sent. Nothing further is needed from you.",
    foot: "Typically 12–30 seconds",
    expected: 20_000,
  },
  settle: {
    title: "Settling the round",
    body: "The round's two public figures are being decrypted and proved back to the contract. This step is open to anyone and discloses nothing about any individual.",
    foot: "A few seconds",
    expected: 8_000,
  },
};

/// Approach the end without ever claiming to have reached it.
///
/// A bar that hits 100% and then sits there is worse than no bar at all, and
/// these durations are genuinely variable. This eases toward 95% along the
/// expected curve and only completes when the work actually does — by which
/// point the overlay is already gone.
function progress(elapsed: number, expected: number): number {
  return 0.95 * (1 - Math.exp(-elapsed / (expected / 2.5)));
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
      className="fixed inset-0 z-[80] flex items-center justify-center bg-field/94 p-6 backdrop-blur-[2px]"
    >
      <div className="rise w-[min(500px,100%)] rounded-plate bg-plate px-10 py-11">
        <div className="mb-9 flex justify-center">
          {/* Seeded from the pool's own address — real, public, and never
              anything derived from the amount being sealed. */}
          <Rosette
            seed={contracts?.prizePool}
            size={104}
            spin
            className="text-slate/70"
          />
        </div>
        <div className="label mb-3 text-center text-slate">{plan.foot}</div>
        <h2 className="wide m-0 text-center text-[26px] leading-[1.15] font-semibold">
          {plan.title}
        </h2>
        <p className="m-0 mx-auto mt-4 max-w-[44ch] text-center text-[14px] leading-[1.65] text-slate">
          {plan.body}
        </p>
        <div className="mt-9 h-px w-full bg-line">
          <div
            className="h-px bg-ink transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
