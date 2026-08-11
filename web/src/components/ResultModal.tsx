import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { Result } from "@/lib/shell";

/// The moment the product builds towards.
///
/// Everything before it is deliberately undramatic — that is the privacy
/// argument, and why a win and a loss cost identical gas and look identical
/// onchain. But the instant someone decrypts their own winnings they learn
/// something nobody else on earth can, and the interface should act like it
/// knows that.
///
/// A loss is not punished. Nothing was lost — that is the entire product.
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="alertdialog"
        aria-label="Your result"
        onClick={(e) => e.stopPropagation()}
        className="pop w-[min(440px,100%)] rounded-card border border-line bg-surface p-8 text-center outline-none"
      >
        <div className="text-[40px]">{result.won ? "🎉" : "🔒"}</div>

        <div className="label mt-4">Only you can read this</div>
        <div
          className={
            "num mt-3 text-[clamp(40px,9vw,58px)] leading-none font-extrabold " +
            (result.won ? "text-mint" : "text-text")
          }
        >
          {formatMoney(result.amount)}
          <span className="ml-2 text-[18px] font-bold">cUSD</span>
        </div>

        <h2 className="m-0 mt-5 text-[21px] font-extrabold">
          {result.won ? "You won this round" : "Not this round"}
        </h2>
        <p className="mx-auto m-0 mt-2.5 max-w-[36ch] text-[14px] leading-relaxed text-muted">
          {result.won
            ? "It's in your winnings, and nothing onchain records that it landed with you. Claim it whenever you like."
            : "Your deposit is exactly where you left it, and its weight carries into the next round."}
        </p>

        <div className="mt-7">
          <Button full size="lg" variant={result.won ? "mint" : "ghost"} onClick={onClose}>
            {result.won ? "Nice" : "Close"}
          </Button>
        </div>
      </div>
    </div>
  );
}
