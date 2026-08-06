import { useCallback, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { Abi, Address } from "viem";
import { explainError } from "@/lib/errors";

type State = { busy: boolean; error: string | null; hash: `0x${string}` | null };

/// Send a write and wait for the receipt, surfacing failures as text a user can
/// act on rather than a raw provider error.
export function useTx() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<State>({ busy: false, error: null, hash: null });

  const send = useCallback(
    async (args: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
    }): Promise<boolean> => {
      if (!walletClient || !publicClient) {
        setState({ busy: false, error: "Connect a wallet first.", hash: null });
        return false;
      }
      setState({ busy: true, error: null, hash: null });
      try {
        const hash = await walletClient.writeContract({
          address: args.address,
          abi: args.abi,
          functionName: args.functionName,
          args: args.args ?? [],
          chain: walletClient.chain,
          account: walletClient.account!,
        });
        setState((s) => ({ ...s, hash }));
        const rc = await publicClient.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") throw new Error("Transaction reverted.");
        setState({ busy: false, error: null, hash });
        return true;
      } catch (e) {
        setState({ busy: false, error: explainError(e), hash: null });
        return false;
      }
    },
    [walletClient, publicClient]
  );

  const clear = useCallback(
    () => setState({ busy: false, error: null, hash: null }),
    []
  );

  return { ...state, send, clear };
}
