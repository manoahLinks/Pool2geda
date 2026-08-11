import { useEffect, useState } from "react";
import { Rosette } from "@/components/Rosette";
import type { Secret } from "@/hooks/useSecret";
import { useShell } from "@/lib/shell";
import { formatMoney } from "@/lib/format";

/// ── The seal ──────────────────────────────────────────────────────────────
///
/// The signature element of the whole product, and the only place its visual
/// energy is spent.
///
/// A sealed figure is not blanked out and it is not a padlock icon. The pattern
/// you see is computed from the very ciphertext handle the value is stored as,
/// and it stands *in the position the figure will occupy* — so unsealing reads
/// as one substitution rather than two events. Beneath it sits the real handle,
/// in mono, because the strongest argument this product can make is that the
/// number is right there in public and still unreadable.
///
/// Unsealing runs a single orchestrated movement: the pattern contracts and
/// dims away while the figure resolves out of focus and counts up into place.

/// Count a figure up into position. Purely an entrance on a value already
/// known — never a progress indication.
function useResolve(value: bigint | null): bigint | null {
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
      const p = Math.min(1, (t - t0) / 640);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(BigInt(Math.round(target * eased)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return shown;
}

const SCALE = {
  hero: { rosette: 116, fig: "text-[clamp(48px,8vw,84px)]", gap: "gap-6" },
  panel: { rosette: 72, fig: "text-[clamp(34px,5vw,46px)]", gap: "gap-5" },
  row: { rosette: 30, fig: "text-[22px]", gap: "gap-3" },
} as const;

export function Seal({
  handle,
  secret,
  label,
  cta = "Unseal with your key",
  scale = "panel",
}: {
  handle?: string;
  secret: Secret;
  /// Used in the accessible name of the unseal control.
  label: string;
  cta?: string;
  scale?: keyof typeof SCALE;
}) {
  const s = SCALE[scale];
  const shown = useResolve(secret.value);
  const row = scale === "row";

  // Keeps the pattern on screen for one beat after the figure arrives, so the
  // two halves of the movement overlap — the rosette collapses out of the exact
  // spot the numeral resolves into.
  const [collapsing, setCollapsing] = useState(false);
  useEffect(() => {
    if (secret.value === null) {
      setCollapsing(false);
      return;
    }
    setCollapsing(true);
    const t = setTimeout(() => setCollapsing(false), 700);
    return () => clearTimeout(t);
  }, [secret.value]);

  // ── reading ────────────────────────────────────────────────────────────
  if (secret.busy) {
    return (
      <div role="status" aria-live="polite" className={`flex items-center ${s.gap}`}>
        <Rosette seed={handle} size={s.rosette} spin className="text-slate" />
        <span className="label text-slate">Reading with your key</span>
      </div>
    );
  }

  // ── resolved ───────────────────────────────────────────────────────────
  if (secret.value !== null && shown !== null) {
    return (
      <div className={"relative " + (row ? "flex items-baseline gap-3" : "")}>
        {collapsing && !row && (
          <div
            aria-hidden="true"
            className="collapse pointer-events-none absolute top-0 left-0"
          >
            <Rosette seed={handle} size={s.rosette} className="text-slate/75" />
          </div>
        )}
        <div className={`fig resolve text-brass ${s.fig}`}>
          {formatMoney(shown)}
          <span className="label ml-2.5 align-baseline text-brass-deep">USD</span>
        </div>
        {!row && (
          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={secret.hide}
              className="label cursor-pointer border-none bg-transparent p-0 text-slate underline underline-offset-4 decoration-line transition-colors hover:text-ink hover:decoration-ink"
            >
              Seal again
            </button>
            <span className="data text-slate">{prefix(handle)}</span>
          </div>
        )}
      </div>
    );
  }

  // ── sealed ─────────────────────────────────────────────────────────────
  if (row) {
    return (
      <div className="flex items-center gap-3">
        <Rosette seed={handle} size={s.rosette} className="text-slate/70" />
        <button
          type="button"
          onClick={() => void secret.reveal()}
          aria-label={`Unseal ${label}. Takes a few seconds and uses your wallet key.`}
          className="label cursor-pointer border-none bg-transparent p-0 text-ink underline underline-offset-4 decoration-line transition-colors hover:decoration-ink"
        >
          Unseal
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ height: s.rosette }} className="flex items-center">
        <Rosette seed={handle} size={s.rosette} className="text-slate/75" />
      </div>
      <div className="data mt-4 text-slate">{prefix(handle)}</div>
      <button
        type="button"
        onClick={() => void secret.reveal()}
        aria-label={`Unseal ${label}. Takes a few seconds and uses your wallet key.`}
        className="wide mt-4 cursor-pointer rounded-[3px] bg-ink px-5 py-3 text-[14px] font-semibold text-field transition-colors hover:bg-slate"
      >
        {cta}
      </button>
    </div>
  );
}

/// Somebody else's figure. No control, because no key here would work — and
/// pressing it says so rather than doing nothing.
export function ForeignSeal({ handle }: { handle?: string }) {
  const { notify } = useShell();
  return (
    <button
      type="button"
      onClick={() =>
        notify({
          tone: "bad",
          title: "Not yours to open",
          body: "Only the holder's key resolves this figure. That is the whole arrangement — and yours is exactly as closed to them.",
        })
      }
      aria-label="Sealed figure belonging to another saver"
      className="flex cursor-not-allowed items-center gap-3 border-none bg-transparent p-0"
    >
      <Rosette seed={handle} size={30} className="text-slate/45" />
      <span className="data text-slate">{prefix(handle, 10)}</span>
    </button>
  );
}

/// The leading bytes of the real on-chain handle. Always visible next to a
/// seal: it is the evidence that the value is public and still unreadable.
function prefix(handle?: string, chars = 18): string {
  if (!handle) return "—";
  return handle.slice(0, chars) + "…";
}
