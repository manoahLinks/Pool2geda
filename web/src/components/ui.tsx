import type { ReactNode } from "react";

export function Card({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "rounded-2xl border border-white/[0.08] bg-vault/70 p-5 backdrop-blur-sm " +
        className
      }
    >
      {label && (
        <h2 className="mb-4 font-mono text-[11px] tracking-[0.14em] text-mist/70 uppercase">
          {label}
        </h2>
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition " +
        "disabled:cursor-not-allowed disabled:opacity-35 " +
        (size === "lg" ? "px-6 py-3 text-base " : "px-4 py-2 text-sm ") +
        (variant === "primary"
          ? "bg-seal text-white hover:bg-seal/85 active:bg-seal/95"
          : "border border-white/12 text-mist hover:border-white/25 hover:text-white")
      }
    >
      {busy && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
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
    <div className="flex items-center gap-2 rounded-xl border border-white/12 bg-black/30 px-3.5 py-2.5 focus-within:border-seal/60">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        className="w-full bg-transparent font-mono text-base outline-none placeholder:text-mist/30 disabled:opacity-50"
      />
      {suffix && <span className="font-mono text-xs text-mist/60">{suffix}</span>}
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
        "rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed " +
        (kind === "error"
          ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-200"
          : "border-white/10 bg-white/[0.03] text-mist")
      }
    >
      {children}
    </div>
  );
}

/// A value that lives on-chain as a ciphertext.
///
/// Shows the real handle, hatched and unreadable, until the holder decrypts it
/// — then it resolves in gold. The point is that you can see the chain holds
/// something and that only your wallet turns it into a number. A UI that
/// silently decrypts everything on load looks identical to one with no
/// encryption at all.
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
  const text =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg";

  if (value !== null) {
    return (
      <span className={`unsealed font-mono ${text} tabular-nums`}>
        {value.toString()}
        {suffix && <span className="ml-1 text-xs text-reveal/60">{suffix}</span>}
      </span>
    );
  }

  const glyphs = handle ? handle.slice(2, 14) : "············";

  return (
    <button
      onClick={onReveal}
      disabled={busy || !onReveal}
      title={onReveal ? "Decrypt with your wallet" : "Only the holder can read this"}
      className="group inline-flex items-center gap-2.5 disabled:cursor-default"
    >
      <span className={`sealed px-2 py-0.5 font-mono ${text} tracking-tight`}>
        {glyphs}
      </span>
      {onReveal && (
        <span className="font-mono text-[11px] tracking-wide text-seal group-hover:text-reveal">
          {busy ? "decrypting…" : "decrypt"}
        </span>
      )}
    </button>
  );
}

export function Stat({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[11px] tracking-[0.12em] text-mist/60 uppercase">
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
