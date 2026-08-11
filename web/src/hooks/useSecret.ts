import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { Address, Hex } from "viem";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { userDecryptOne, isZeroHandle } from "@/lib/decrypt";
import { describeError, type ErrorNote } from "@/lib/errors";
import { useShell } from "@/lib/shell";

export type Secret = {
  value: bigint | null;
  busy: boolean;
  /// `override` decrypts a handle the caller just re-read, rather than the one
  /// this hook last rendered with. Needed straight after a write: React state
  /// lags the chain by a render, and decrypting the stale handle silently
  /// returns the previous value.
  reveal: (override?: Hex) => Promise<bigint | null>;
  hide: () => void;
};

/// Decrypt-on-demand for a single encrypted value the caller owns.
///
/// Deliberately NOT automatic: decryption costs a wallet signature the first
/// time and a relayer round trip every time, so it happens when the user asks.
/// A UI that silently decrypts everything on load looks identical to one with
/// no encryption at all.
///
/// The handle is reset to hidden whenever it changes, so a stale plaintext is
/// never shown against a new ciphertext — which would be worse than showing
/// nothing.
///
/// Unlike the transaction paths this does NOT go behind the waiting overlay:
/// unsealing is a local, per-value act and belongs next to the figure it
/// reveals. Failures still route to the single notice bar.
export function useSecret(
  handle: Hex | undefined,
  contractAddress: Address
): Secret {
  const { ready, getSdk } = useZamaSdk();
  const { address } = useAccount();
  const { notify } = useShell();
  const [value, setValue] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(null);
  }, [handle, address]);

  const reveal = useCallback(async (override?: Hex): Promise<bigint | null> => {
    const target = override ?? handle;
    if (!target) return null;
    // A handle that was never written decrypts to nothing — short-circuit
    // rather than sending the relayer a request it will reject.
    if (isZeroHandle(target)) {
      setValue(0n);
      return 0n;
    }
    if (!ready) {
      notify({
        tone: "bad",
        title: "Connect your wallet first",
        body: "Reading your own numbers takes your key, so a wallet has to be connected.",
      });
      return null;
    }
    setBusy(true);
    try {
      const sdk = await getSdk();
      const v = await userDecryptOne(sdk, target, contractAddress);
      setValue(v);
      return v;
    } catch (e) {
      const note: ErrorNote = describeError(e);
      notify({ tone: "bad", ...note });
      return null;
    } finally {
      setBusy(false);
    }
  }, [ready, getSdk, handle, contractAddress, notify]);

  return { value, busy, reveal, hide: () => setValue(null) };
}
