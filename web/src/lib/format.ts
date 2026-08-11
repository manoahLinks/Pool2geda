import { DECIMALS } from "@/config/contracts";

/// Both tUSD and cUSD use 6 decimals — the ERC-7984 wrapper caps there.
export function formatUnits(v: bigint, decimals = DECIMALS): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const s = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return neg ? `-${s}` : s;
}

/// A figure as it appears in the UI: grouped thousands, always two decimals.
///
/// Amounts are money, and money is read at a glance — 2,500.00 rather than
/// 2500. Kept separate from `formatUnits`, which stays exact for anywhere the
/// precise on-chain value matters.
export function formatMoney(v: bigint, decimals = DECIMALS): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/// Parse user input into base units. Throws on anything that isn't a clean
/// positive decimal, so a typo can't silently become a different amount.
export function parseUnits(input: string, decimals = DECIMALS): bigint {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Enter a number, e.g. 25.5");
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(`At most ${decimals} decimal places.`);
  }
  const v = BigInt(whole + frac.padEnd(decimals, "0"));
  if (v <= 0n) throw new Error("Amount must be greater than zero.");
  // euint64 ceiling — deposits are stored as euint64 on-chain.
  if (v > 2n ** 64n - 1n) throw new Error("Amount too large.");
  return v;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function secondsUntil(ts: bigint | number): number {
  return Math.max(0, Number(ts) - Math.floor(Date.now() / 1000));
}

/// Countdown text. Seconds are dropped past the hour mark — nobody watches the
/// second hand on a two-hour timer, and the narrower string stops the headline
/// reflowing every tick.
export function formatDuration(s: number): string {
  if (s <= 0) return "now";
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}m ${pad(sec)}s`;
}
