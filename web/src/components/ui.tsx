import type { ReactNode } from "react";

export function Panel({
  title,
  step,
  subtitle,
  children,
  tone = "default",
}: {
  title: string;
  step?: number;
  subtitle?: ReactNode;
  children: ReactNode;
  tone?: "default" | "encrypted";
}) {
  return (
    <section
      className={
        "rounded-2xl border p-5 backdrop-blur " +
        (tone === "encrypted"
          ? "border-violet-400/25 bg-violet-400/[0.07]"
          : "border-white/10 bg-white/5")
      }
    >
      <div className="flex items-baseline gap-2">
        {step !== undefined && (
          <span className="text-xs font-mono text-white/35">{step}</span>
        )}
        <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">
          {title}
        </h2>
        {tone === "encrypted" && (
          <span className="ml-auto rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] font-medium tracking-wide text-violet-200 uppercase">
            Encrypted
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  busy,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "ghost";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition " +
        "disabled:cursor-not-allowed disabled:opacity-40 " +
        (variant === "primary"
          ? "bg-violet-500 text-white hover:bg-violet-400"
          : "border border-white/15 text-white/80 hover:bg-white/5")
      }
    >
      {busy && (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      )}
      {children}
    </button>
  );
}

export function AmountField({
  value,
  onChange,
  placeholder = "0.00",
  suffix,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/25 px-3 py-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        className="w-full bg-transparent text-sm outline-none placeholder:text-white/25 disabled:opacity-50"
      />
      {suffix && <span className="text-xs text-white/40">{suffix}</span>}
    </div>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: "error" | "info" | "success";
  children: ReactNode;
}) {
  const tone =
    kind === "error"
      ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
      : kind === "success"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
        : "border-sky-400/25 bg-sky-400/10 text-sky-200";
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone}`}>
      {children}
    </div>
  );
}

/// Renders an encrypted value as a redacted shimmer until the holder decrypts
/// it. The point is to make the confidentiality model visible rather than
/// merely claimed — you can see that the chain holds a ciphertext, and that
/// only your wallet turns it into a number.
export function Secret({
  value,
  onReveal,
  busy,
  suffix,
  emptyLabel = "—",
}: {
  value: bigint | null;
  onReveal: () => void;
  busy?: boolean;
  suffix?: string;
  emptyLabel?: string;
}) {
  if (value !== null) {
    return (
      <span className="font-mono text-lg">
        {value === 0n ? emptyLabel : value.toString()}
        {suffix && <span className="ml-1 text-xs text-white/40">{suffix}</span>}
      </span>
    );
  }
  return (
    <button
      onClick={onReveal}
      disabled={busy}
      title="Decrypt with your wallet"
      className="group inline-flex items-center gap-2 disabled:opacity-60"
    >
      <span className="cipher px-8 py-0.5 font-mono text-lg">••••••</span>
      <span className="text-xs text-violet-300 group-hover:text-violet-200">
        {busy ? "decrypting…" : "decrypt"}
      </span>
    </button>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-white/45">{label}</span>
      {children}
    </div>
  );
}
