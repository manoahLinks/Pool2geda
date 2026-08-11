import { useAccount, useReadContract } from "wagmi";
import type { Abi, Hex } from "viem";
import { contracts } from "@/config/contracts";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { secondsUntil } from "@/lib/format";

const cusdAbi = confidentialUsdAbi as unknown as Abi;

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type SetupStep = "faucet" | "allow";
export const SETUP_ORDER: SetupStep[] = ["faucet", "allow"];

/// How far a new wallet has got.
///
/// Two steps, not four. The asset is confidential from birth, so there is no
/// public token to acquire, approve and wrap first — a judge goes from empty
/// wallet to depositing in two transactions.
///
/// The balance can only be probed for existence, never for size: the app
/// genuinely cannot read it. Whether a handle has ever been written is enough
/// to route the flow, and over-depositing is caught after the fact by the
/// saturation check rather than prevented here.
export function useSetup() {
  const { address } = useAccount();
  const c = contracts;
  const enabled = !!c && !!address;

  const { data: cusdHandle, refetch: refetchCusd } = useReadContract({
    address: c?.confidentialUsd,
    abi: cusdAbi,
    functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: nextFaucet, refetch: refetchFaucet } = useReadContract({
    address: c?.confidentialUsd,
    abi: cusdAbi,
    functionName: "nextFaucetAt",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000 },
  });
  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    address: c?.confidentialUsd,
    abi: cusdAbi,
    functionName: "isOperator",
    args: address && c ? [address, c.prizePool] : undefined,
    query: { enabled },
  });

  const hasTokens = !!cusdHandle && cusdHandle !== ZERO_HANDLE;
  const granted = isOperator === true;
  const cooldown = secondsUntil((nextFaucet as bigint) ?? 0n);

  const done: Record<SetupStep, boolean> = {
    faucet: hasTokens,
    allow: granted,
  };

  const refetchAll = async () => {
    await Promise.all([refetchCusd(), refetchFaucet(), refetchOperator()]);
  };

  return {
    balanceHandle: cusdHandle as Hex | undefined,
    hasTokens,
    granted,
    cooldown,
    done,
    autoStep: (!hasTokens ? "faucet" : "allow") as SetupStep,
    /// Ready to deposit: holds confidential tokens and has let the pool move them.
    complete: hasTokens && granted,
    refetchAll,
  };
}
