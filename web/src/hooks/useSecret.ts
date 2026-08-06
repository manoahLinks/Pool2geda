import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Address, Hex } from "viem";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { userDecryptOne, isZeroHandle } from "@/lib/decrypt";
import { explainError } from "@/lib/errors";

/// Decrypt-on-demand for a single encrypted value the caller owns.
///
/// Deliberately NOT automatic: decryption costs a wallet signature the first
/// time and a relayer round trip every time, so it happens when the user asks.
/// The handle is reset to hidden whenever it changes, so a stale plaintext is
/// never shown against a new ciphertext — which would be worse than showing
/// nothing.
export function useSecret(handle: Hex | undefined, contractAddress: Address) {
  const { ready, getSdk } = useZamaSdk();
  const { address } = useAccount();
  const [value, setValue] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(null);
    setError(null);
  }, [handle, address]);

  const reveal = useCallback(async () => {
    if (!handle) return;
    // A handle that was never written decrypts to nothing — short-circuit
    // rather than sending the relayer a request it will reject.
    if (isZeroHandle(handle)) {
      setValue(0n);
      return;
    }
    if (!ready) {
      setError("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sdk = await getSdk();
      setValue(await userDecryptOne(sdk, handle, contractAddress));
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }, [ready, getSdk, handle, contractAddress]);

  return { value, busy, error, reveal, hide: () => setValue(null) };
}
