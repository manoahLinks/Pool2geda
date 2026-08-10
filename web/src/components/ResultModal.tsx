import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { Result } from "@/lib/shell";

/// The one moment the whole product builds towards.
///
/// Everything before it is deliberately undramatic — that is the privacy
/// argument, and the reason a win and a loss cost identical gas and look
/// identical on-chain. But the instant a saver decrypts their own winnings they
/// learn something no one else on earth can learn, and the interface should
/// behave as though it knows that. So it takes the screen, and the figure
/// arrives in brass: the colour this design spends on nothing else.
///
/// A loss is not punished. Nothing was lost — that is the entire product — so
/// it says exactly that and points at the next round.
export function ResultModal({
  result,
  onClose,
}: {
  result: Result;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-6">
      <div
        ref={panel}
        tabIndex={-1}
        role="alertdialog"
        aria-label="Your result"
        className="rise relative w-[min(520px,100%)] overflow-hidden rounded-plate bg-plate px-11 py-12 text-center outline-none"
      >
        {/* Deliberately unornamented. The figure has just come out of a seal —
            putting the pattern back behind it would undo the one thing this
            moment is for. Brass on plate, and nothing else. */}
        <div className="relative">
          <div className="label text-slate">
            Round {result.round.padStart(3, "0")} · readable only by you
          </div>

          <div
            className={
              "fig resolve mt-8 text-[clamp(46px,10vw,80px)] " +
              (result.won ? "text-brass" : "text-ink")
            }
          >
            {formatMoney(result.amount)}
            <span className="label ml-3 align-baseline text-slate">USD</span>
          </div>

          <h2 className="wide m-0 mt-8 text-[24px] leading-[1.15] font-semibold">
            {result.won ? "The prize came to you." : "Not this round."}
          </h2>
          <p className="m-0 mx-auto mt-4 max-w-[38ch] text-[15px] leading-[1.65] text-slate">
            {result.won
              ? "It is sitting in your winnings, and nothing on the chain records that it landed with you. Move it across whenever you like."
              : "Your holding is exactly where you left it, and its weight carries into the next round."}
          </p>

          <div className="mt-10">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
