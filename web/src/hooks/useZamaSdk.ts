import { useMemo } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { ZamaSDK } from "@zama-fhe/sdk";
import { buildZamaSdk } from "@/lib/zama";

/// The SDK instance for the connected wallet, or null until a wallet connects.
///
/// Construction is synchronous, so this is a plain `useMemo` — there is no
/// loading state to model. Memoised on the client identities so we do not
/// rebuild (and drop the cached permits) on every render.
export function useZamaSdk(): ZamaSDK | null {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!publicClient || !walletClient) return null;
    return buildZamaSdk(publicClient, walletClient);
  }, [publicClient, walletClient]);
}
