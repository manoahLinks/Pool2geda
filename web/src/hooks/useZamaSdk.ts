import { useCallback } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { ZamaSDK } from "@zama-fhe/sdk";
import { loadZamaSdk } from "@/lib/zama";

/// Returns a getter rather than an instance, because the SDK is loaded on
/// demand — see lib/zama.ts. Callers await it at the moment they need to
/// encrypt or decrypt, which is always behind a click, so the load is covered
/// by a button's own busy state.
export function useZamaSdk() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const ready = !!publicClient && !!walletClient;

  const getSdk = useCallback(async (): Promise<ZamaSDK> => {
    if (!publicClient || !walletClient) {
      throw new Error("Connect a wallet first.");
    }
    return loadZamaSdk(publicClient, walletClient);
  }, [publicClient, walletClient]);

  return { ready, getSdk };
}
