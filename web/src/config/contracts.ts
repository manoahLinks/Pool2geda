import type { Address } from "viem";

/// Addresses are injected at build time so the same bundle can target a fresh
/// deployment without a code change. `contracts/deploy` writes these into
/// web/.env after each deploy.
///
/// Deliberately does NOT throw at module scope: a missing address would then
/// white-screen the entire app with a stack trace in the console. Instead the
/// UI renders a specific "not configured" state naming what is missing.

const PATTERN = /^0x[0-9a-fA-F]{40}$/;

const RAW = {
  testUsd: import.meta.env.VITE_TEST_USD_ADDRESS,
  confidentialUsd: import.meta.env.VITE_CONFIDENTIAL_USD_ADDRESS,
  prizePool: import.meta.env.VITE_PRIZE_POOL_ADDRESS,
} as const;

const ENV_NAMES: Record<keyof typeof RAW, string> = {
  testUsd: "VITE_TEST_USD_ADDRESS",
  confidentialUsd: "VITE_CONFIDENTIAL_USD_ADDRESS",
  prizePool: "VITE_PRIZE_POOL_ADDRESS",
};

export type Contracts = { [K in keyof typeof RAW]: Address };

/// Missing env var names, empty when fully configured.
export const missingContractEnv: string[] = (
  Object.keys(RAW) as (keyof typeof RAW)[]
).filter((k) => !RAW[k] || !PATTERN.test(RAW[k] as string)).map((k) => ENV_NAMES[k]);

export const contracts: Contracts | null =
  missingContractEnv.length === 0 ? (RAW as unknown as Contracts) : null;

/// cUSD and tUSD both use 6 decimals (the ERC-7984 wrapper caps at 6).
export const DECIMALS = 6;

/// Operator grants are what let the pool pull cUSD on deposit. Far-future so a
/// user grants once rather than on every deposit.
export const OPERATOR_EXPIRY = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
