import { useEffect, type ReactNode } from "react";
import type { Notice } from "@/lib/shell";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-surface ${className}`}
    >
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
  full,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "mint" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  full?: boolean;
  title?: string;
}) {
  const sizing =
    size === "lg"
      ? "text-[15px] px-7 py-3.5"
      : size === "sm"
        ? "text-[13px] px-3.5 py-2"
        : "text-[14px] px-5 py-2.5";

  const look =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-soft"
      : variant === "mint"
        ? "bg-mint text-bg hover:brightness-110"
        : variant === "danger"
          ? "bg-transparent text-danger border border-danger/40 hover:border-danger"
          : "bg-surface-2 text-text border border-line hover:border-accent-soft";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-ctl font-bold " +
        "transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 " +
        `${sizing} ${look} ${full ? "w-full" : ""}`
      }
    >
      {busy && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      )}
      {children}
    </button>
  );
}

/// A figure with its caption. The row of these under the hero is the first
/// thing anyone reads, so it carries the live state of the pool.
export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-5 py-4">
      <div className="label">{label}</div>
      <div
        className={
          "num mt-2 text-[26px] leading-none font-extrabold " +
          (accent ? "text-accent-soft" : "text-text")
        }
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "mint" | "danger";
}) {
  const look =
    tone === "accent"
      ? "bg-accent/15 text-accent-soft border-accent/30"
      : tone === "mint"
        ? "bg-mint/15 text-mint border-mint/30"
        : tone === "danger"
          ? "bg-danger/15 text-danger border-danger/30"
          : "bg-surface-2 text-muted border-line";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${look}`}
    >
      {children}
    </span>
  );
}

/// Amount input with the unit pinned right and a MAX affordance, the way every
/// DeFi front end does it — because that is where people look for it.
export function AmountInput({
  value,
  onChange,
  unit,
  onMax,
  hint,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  unit: string;
  onMax?: () => void;
  hint?: ReactNode;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div>
      <label htmlFor="amount" className="sr-only">
        {label}
      </label>
      <div className="flex items-center gap-3 rounded-ctl border border-line bg-bg px-4 py-3.5 transition-colors focus-within:border-accent-soft">
        <input
          id="amount"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          disabled={disabled}
          inputMode="decimal"
          autoComplete="off"
          className="num w-full min-w-0 bg-transparent text-[22px] font-bold text-text outline-none disabled:opacity-40"
        />
        <span className="shrink-0 text-[14px] font-bold text-muted">{unit}</span>
        {onMax && (
          <button
            type="button"
            onClick={onMax}
            className="shrink-0 cursor-pointer rounded-md bg-accent/20 px-2 py-1 text-[11px] font-extrabold text-accent-soft transition-colors hover:bg-accent/35"
          >
            MAX
          </button>
        )}
      </div>
      {hint && (
        <div className="mt-2 flex items-center justify-between text-[13px] text-muted">
          {hint}
        </div>
      )}
    </div>
  );
}

/// Key/value line inside a modal summary block.
export function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-[14px]">
      <span className="text-muted">{k}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}

/// One notice at a time, at the top of the page.
export function NoticeBar({
  notice,
  onDismiss,
}: {
  notice: Notice;
  /// Omitted for conditions the user cannot dismiss their way out of. A × that
  /// does nothing is worse than no ×.
  onDismiss?: () => void;
}) {
  const bad = notice.tone === "bad";
  return (
    <div
      role="status"
      className={
        "fade-up mb-6 flex items-start gap-4 rounded-card border px-5 py-4 " +
        (bad
          ? "border-danger/30 bg-danger/10"
          : "border-mint/30 bg-mint/10")
      }
    >
      <div className="min-w-0 flex-1">
        <div
          className={
            "text-[15px] font-extrabold " + (bad ? "text-danger" : "text-mint")
          }
        >
          {notice.title}
        </div>
        <div className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          {notice.body}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 cursor-pointer rounded-md px-1.5 text-lg leading-none text-muted transition-colors hover:text-text"
        >
          ×
        </button>
      )}
    </div>
  );
}

/// Centred dialog. Escape and backdrop both close it, focus moves in, and the
/// page behind stops scrolling — the things people expect and notice only when
/// they are missing.
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ width: `min(${width}px, 100%)` }}
        className="pop max-h-[90vh] overflow-y-auto rounded-card border border-line bg-surface p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="m-0 text-[20px] font-extrabold">{title}</h2>
            {subtitle && (
              <p className="m-0 mt-1 text-[13px] text-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md px-2 text-xl leading-none text-muted transition-colors hover:text-text"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/// Segmented control — used for Deposit/Withdraw inside the modal, and for the
/// main navigation.
export function Segments<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-ctl border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            "flex-1 cursor-pointer rounded-[9px] px-4 py-2 text-[14px] font-bold transition-colors " +
            (value === o.value
              ? "bg-accent text-white"
              : "text-muted hover:text-text")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
