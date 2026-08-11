import type { ReactNode } from "react";
import type { Notice } from "@/lib/shell";

/// A raised surface. Defined by tone alone — no border, no shadow, 4px radius.
/// The instrument's panels, not an app's cards.
export function Plate({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-plate bg-plate ${className}`}>{children}</section>
  );
}

/// A section mark. Mono, tracked, uppercase — the way an instrument annotates
/// its own dials rather than the way a website titles a card.
export function Label({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "ink" | "brass";
}) {
  const c =
    tone === "ink" ? "text-ink" : tone === "brass" ? "text-brass-deep" : "text-slate";
  return <div className={`label ${c}`}>{children}</div>;
}

/// Buttons are rectangles with a 3px radius. Nothing here is a pill: pills read
/// as consumer software, and this is meant to read as an instrument.
export function Button({
  children,
  onClick,
  disabled,
  busy,
  variant = "primary",
  size = "md",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "quiet" | "bare";
  size?: "sm" | "md" | "lg";
  title?: string;
}) {
  const sizing =
    size === "lg"
      ? "text-[15px] px-7 py-4"
      : size === "sm"
        ? "text-[13px] px-4 py-2.5"
        : "text-[14px] px-5 py-3";

  const look =
    variant === "primary"
      ? "bg-ink text-field hover:bg-slate"
      : variant === "quiet"
        ? "bg-transparent text-ink ring-1 ring-inset ring-line hover:ring-ink"
        : "bg-transparent text-slate hover:text-ink underline underline-offset-4 decoration-line hover:decoration-ink";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={
        "wide inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-[3px] font-semibold " +
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 " +
        `${sizing} ${look}`
      }
    >
      {busy && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current" />
      )}
      {children}
    </button>
  );
}

/// An amount, entered in the same face the resolved figure will appear in — so
/// what you type already looks like what you are about to seal.
export function AmountField({
  value,
  onChange,
  unit,
  hint,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  unit: string;
  hint?: string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div>
      <label htmlFor="amount" className="sr-only">
        {label}
      </label>
      <div className="flex items-baseline gap-3 border-b border-line pb-2 transition-colors focus-within:border-ink">
        <input
          id="amount"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          disabled={disabled}
          inputMode="decimal"
          autoComplete="off"
          className="fig w-full min-w-0 bg-transparent text-[38px] text-ink outline-none disabled:opacity-40"
        />
        <span className="label shrink-0 text-slate">{unit}</span>
      </div>
      {hint && <div className="data mt-2 text-slate">{hint}</div>}
    </div>
  );
}

/// The app says one thing at a time. Every failure, and every outcome worth
/// remarking on, lands here rather than beside the control that caused it.
export function NoticeBar({
  notice,
  onDismiss,
}: {
  notice: Notice;
  /// Omitted for conditions the user cannot dismiss their way out of — a wrong
  /// network, or a build with no deployment behind it. A × that does nothing is
  /// worse than no ×.
  onDismiss?: () => void;
}) {
  const bad = notice.tone === "bad";
  return (
    <div
      role="status"
      className="rise mb-10 flex items-start gap-5 border-l-2 bg-plate py-4 pr-4 pl-5"
      style={{ borderColor: bad ? "var(--color-signal)" : "var(--color-ink)" }}
    >
      <div className="min-w-0 flex-1">
        <div
          className={
            "wide mb-1 text-[15px] font-semibold " +
            (bad ? "text-signal" : "text-ink")
          }
        >
          {notice.title}
        </div>
        <div className="max-w-[68ch] text-[14px] leading-[1.6] text-slate">
          {notice.body}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 cursor-pointer border-none bg-transparent px-1 text-lg leading-none text-slate transition-colors hover:text-ink"
        >
          ×
        </button>
      )}
    </div>
  );
}
