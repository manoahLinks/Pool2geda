import { useEffect, useState } from "react";
import { Rosette } from "@/components/Rosette";
import type { Secret } from "@/hooks/useSecret";
import { useShell } from "@/lib/shell";
import { formatMoney } from "@/lib/format";

/// A figure the chain holds as ciphertext.
///
/// The one thing in this interface that is not a standard DeFi component, and
/// the only place the product's premise is visible. A sealed figure is not
/// blanked out and it is not a padlock — the pattern is generated from the very
/// ciphertext handle the value is stored as, so what you are looking at *is*
/// the encrypted value, drawn.
///
/// Unsealing is never automatic. It costs a wallet signature the first time and
/// a relayer round trip every time, and an interface that silently decrypts
/// everything on load looks identical to one with no encryption at all.
///
/// Mint means decrypted-and-yours, and nothing else in the app is allowed to
/// use it.

/// Count the figure up into place. An entrance on a known value, never a
/// progress indication.
function useCountUp(value: bigint | null): bigint | null {
  const [shown, setShown] = useState<bigint | null>(value);

  useEffect(() => {
    if (value === null) {
      setShown(null);
      return;
    }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value === 0n) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const target = Number(value);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 560);
      setShown(BigInt(Math.round(target * (1 - Math.pow(1 - p, 3)))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return shown;
}

export function Value({
  handle,
  secret,
  label,
  size = "md",
  unit = "cUSD",
}: {
  handle?: string;
  secret: Secret;
  /// Used in the accessible name of the unseal control.
  label: string;
  size?: "sm" | "md" | "lg";
  unit?: string;
}) {
  const shown = useCountUp(secret.value);
  const big = size === "lg";
  const sm = size === "sm";

  const figure = big
    ? "text-[clamp(34px,6vw,52px)]"
    : sm
      ? "text-[17px]"
      : "text-[30px]";

  if (secret.busy) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-3">
        <Rosette
          seed={handle}
          size={sm ? 24 : big ? 44 : 32}
          spin
          className="text-accent-soft"
        />
        <span className={"font-bold text-muted " + (sm ? "text-[13px]" : "text-[15px]")}>
          Decrypting…
        </span>
      </div>
    );
  }

  if (secret.value !== null && shown !== null) {
    return (
      <div className={sm ? "flex items-center gap-2" : ""}>
        <div className={`num pop font-extrabold text-mint ${figure}`}>
          {formatMoney(shown)}
          <span className={"ml-2 font-bold " + (big ? "text-[18px]" : "text-[13px]")}>
            {unit}
          </span>
        </div>
        {!sm && (
          <button
            type="button"
            onClick={secret.hide}
            className="mt-3 cursor-pointer text-[13px] font-bold text-muted underline underline-offset-4 transition-colors hover:text-text"
          >
            Hide
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={sm ? "flex items-center gap-2.5" : "flex items-center gap-4"}>
      <Rosette
        seed={handle}
        size={sm ? 24 : big ? 44 : 32}
        className="text-accent-soft opacity-70"
      />
      <button
        type="button"
        onClick={() => void secret.reveal()}
        aria-label={`Decrypt ${label} with your wallet key. Takes a few seconds.`}
        className={
          "cursor-pointer rounded-ctl border border-line bg-surface-2 font-bold text-text transition-colors hover:border-accent-soft " +
          (sm ? "px-3 py-1.5 text-[12px]" : "px-4 py-2 text-[14px]")
        }
      >
        Decrypt
      </button>
    </div>
  );
}

/// Somebody else's figure. No control, because no key here would work —
/// pressing it explains that rather than doing nothing.
export function ForeignValue({ handle }: { handle?: string }) {
  const { notify } = useShell();
  return (
    <button
      type="button"
      onClick={() =>
        notify({
          tone: "bad",
          title: "Not yours to decrypt",
          body: "Only the holder's key opens this figure — and yours is exactly as closed to them. That is the whole point of the pool.",
        })
      }
      aria-label="Encrypted balance belonging to another saver"
      className="flex cursor-not-allowed items-center gap-2.5"
    >
      <Rosette seed={handle} size={24} className="text-muted opacity-50" />
      <span className="mono text-muted">Encrypted</span>
    </button>
  );
}
