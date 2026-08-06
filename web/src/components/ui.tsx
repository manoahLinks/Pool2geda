import type { ReactNode } from "react";
import { GuillocheBand } from "@/components/Guilloche";

/// A panel on the certificate. Engraved rule above, small-caps caption — the
/// way a section is titled on a share certificate rather than a dashboard.
export function Panel({
  caption,
  children,
  className = "",
}: {
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "border border-ink/15 bg-stock-2/40 px-5 py-4 shadow-[0_1px_0_rgba(18,33,27,0.06)] " +
        className
      }
    >
      {caption && (
        <div className="mb-3 flex items-center gap-3">
          <h2 className="serif-caps text-[10px] text-bank">{caption}</h2>
          <span className="h-px flex-1 bg-ink/12" />
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  busy,
  variant = "primary",
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "ghost";
  size?: "md" | "lg";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={
        "serif-caps inline-flex items-center justify-center gap-2 border transition " +
        "disabled:cursor-not-allowed disabled:opacity-35 " +
        (size === "lg" ? "px-6 py-3 text-[11px] " : "px-4 py-2 text-[10px] ") +
        (variant === "primary"
          ? "border-ink bg-ink text-stock hover:bg-bank hover:border-bank"
          : "border-ink/30 text-ink hover:border-ink hover:bg-ink/[0.04]")
      }
    >
      {busy && (
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current" />
      )}
      {children}
    </button>
  );
}

export function AmountField({
  value,
  onChange,
  suffix,
  disabled,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 border-b border-ink/25 px-1 py-1.5 focus-within:border-ink">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        className="w-full bg-transparent font-mono text-lg tabular-nums outline-none placeholder:text-faint/50 disabled:opacity-50"
      />
      {suffix && (
        <span className="serif-caps shrink-0 text-[9px] text-faint">{suffix}</span>
      )}
    </div>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "error" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={
        "border-l-2 py-1.5 pl-3 text-[12px] leading-relaxed " +
        (kind === "error"
          ? "border-carmine bg-carmine/[0.05] text-carmine"
          : "border-bank/40 text-faint")
      }
    >
      {children}
    </div>
  );
}

/// A value the chain holds as ciphertext.
///
/// Sealed, it is drawn as guilloche generated from the handle itself — the
/// same role the lathe-work plays on a banknote: intricate, precise, and
/// impossible to read back. Decryption strikes the figure onto the paper.
export function Sealed({
  handle,
  value,
  busy,
  onReveal,
  suffix,
  size = "md",
}: {
  handle?: string;
  value: bigint | null;
  busy?: boolean;
  onReveal?: () => void;
  suffix?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims =
    size === "lg"
      ? { w: 210, h: 34, text: "text-4xl" }
      : size === "sm"
        ? { w: 120, h: 20, text: "text-base" }
        : { w: 165, h: 26, text: "text-2xl" };

  if (value !== null) {
    return (
      <span className={`struck engraved ${dims.text} text-ink`}>
        {value.toString()}
        {suffix && (
          <span className="serif-caps ml-1.5 align-middle text-[9px] text-faint">
            {suffix}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      onClick={onReveal}
      disabled={busy || !onReveal}
      title={onReveal ? "Decrypt with your key" : "Only the holder can read this"}
      className="group inline-flex items-center gap-2.5 disabled:cursor-default"
    >
      <GuillocheBand
        seed={handle}
        width={dims.w}
        height={dims.h}
        className="text-bank"
      />
      {onReveal && (
        <span className="serif-caps text-[9px] text-carmine group-hover:text-ink">
          {busy ? "decrypting" : "decrypt"}
        </span>
      )}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="serif-caps text-[9px] text-faint">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/// Serial numbers, printed in the corners the way a note carries its plate and
/// series marks. Real values — the contract addresses actually in use.
export function Serial({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-[9px] tracking-wider text-faint/70">
      <span className="text-faint/50">{label}</span> {value}
    </span>
  );
}
