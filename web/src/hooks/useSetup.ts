import { useAccount, useReadContract } from "wagmi";
import type { Abi, Hex } from "viem";
import { contracts } from "@/config/contracts";
import { testUsdAbi } from "@/abi/testUsd";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { secondsUntil } from "@/lib/format";

const usdAbi = testUsdAbi as unknown as Abi;
const cusdAbi = confidentialUsdAbi as unknown as Abi;

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type SetupStep = "faucet" | "convert" | "allow" | "deposit";
export const SETUP_ORDER: SetupStep[] = ["faucet", "convert", "allow", "deposit"];

/// Everything needed to know where a new saver has got to.
///
/// The private balance can only be probed for existence, never for size — the
/// app genuinely cannot read it. Whether a handle has ever been written is
/// enough to route the flow, and depositing more than you hold is caught after
/// the fact by the saturation check rather than prevented here.
export function useSetup() {
  const { address } = useAccount();
  const c = contracts;
  const enabled = !!c && !!address;

  const { data: usdBal, refetch: refetchUsd } = useReadContract({
    address: c?.testUsd,
    abi: usdAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: nextFaucet, refetch: refetchFaucet } = useReadContract({
    address: c?.testUsd,
    abi: usdAbi,
    functionName: "nextFaucetAt",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: c?.testUsd,
    abi: usdAbi,
    functionName: "allowance",
    args: address && c ? [address, c.confidentialUsd] : undefined,
    query: { enabled },
  });
  const { data: cusdHandle, refetch: refetchCusd } = useReadContract({
    address: c?.confidentialUsd,
    abi: cusdAbi,
    functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    address: c?.confidentialUsd,
    abi: cusdAbi,
    functionName: "isOperator",
    args: address && c ? [address, c.prizePool] : undefined,
    query: { enabled },
  });

  const balance = (usdBal as bigint) ?? 0n;
  const hasUsd = balance > 0n;
  const hasPrivate = !!cusdHandle && cusdHandle !== ZERO_HANDLE;
  const granted = isOperator === true;
  const cooldown = secondsUntil((nextFaucet as bigint) ?? 0n);

  const autoStep: SetupStep = !hasUsd && !hasPrivate
    ? "faucet"
    : !hasPrivate
      ? "convert"
      : !granted
        ? "allow"
        : "deposit";

  const done: Record<SetupStep, boolean> = {
    faucet: hasUsd || hasPrivate,
    convert: hasPrivate,
    allow: granted,
    deposit: false,
  };

  const refetchAll = async () => {
    await Promise.all([
      refetchUsd(),
      refetchFaucet(),
      refetchAllowance(),
      refetchCusd(),
      refetchOperator(),
    ]);
  };

  return {
    balance,
    allowance: (allowance as bigint) ?? 0n,
    privateHandle: cusdHandle as Hex | undefined,
    hasUsd,
    hasPrivate,
    granted,
    cooldown,
    autoStep,
    done,
    /// Ready for the main screen: has a private balance and has let the pool
    /// take a deposit from it.
    complete: hasPrivate && granted,
    refetchAll,
  };
}
