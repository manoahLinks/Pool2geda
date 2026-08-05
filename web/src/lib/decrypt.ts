import type { ZamaSDK } from "@zama-fhe/sdk";
import type { Address, Hex } from "viem";

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// A handle that was never written is the zero handle. Decrypting it is not an
/// error — it means "no value yet" — but the relayer will reject the request,
/// so short-circuit to 0.
export function isZeroHandle(handle: Hex | undefined | null): boolean {
  return !handle || handle === ZERO_HANDLE;
}

/// Decrypt one or more of the caller's own encrypted values.
///
/// Prompts for a single wallet signature the first time, then reuses the cached
/// permit. The result is a record keyed by HANDLE, not an array — indexing it
/// positionally is the most common mistake when porting from the legacy SDK.
export async function userDecrypt(
  sdk: ZamaSDK,
  items: { handle: Hex; contractAddress: Address }[]
): Promise<Record<Hex, bigint>> {
  const live = items.filter((i) => !isZeroHandle(i.handle));
  if (live.length === 0) return {};

  const values = await sdk.decryption.decryptValues(
    live.map(({ handle, contractAddress }) => ({
      encryptedValue: handle,
      contractAddress,
    }))
  );

  const out: Record<Hex, bigint> = {};
  for (const { handle } of items) {
    out[handle] = isZeroHandle(handle) ? 0n : BigInt((values[handle] ?? 0n) as bigint);
  }
  return out;
}

/// Convenience wrapper for a single handle.
export async function userDecryptOne(
  sdk: ZamaSDK,
  handle: Hex,
  contractAddress: Address
): Promise<bigint> {
  if (isZeroHandle(handle)) return 0n;
  const res = await userDecrypt(sdk, [{ handle, contractAddress }]);
  return res[handle] ?? 0n;
}

export type PublicDecryptResult = {
  values: bigint[];
  cleartexts: Hex;
  decryptionProof: Hex;
};

/// Publicly decrypt handles and return the values plus the proof a contract
/// needs to verify them.
///
/// Retries because the relayer answers `not_ready_for_decryption` for a while
/// after `makePubliclyDecryptable` lands — the ciphertext has to propagate to
/// the gateway first. Without this the draw flow fails intermittently on a
/// freshly closed epoch, which looks like a contract bug and is not.
///
/// HANDLE ORDER IS LOAD-BEARING: the decryption proof is bound to the exact
/// order supplied, and must match the contract's `cts` array.
export async function publicDecryptWithRetry(
  sdk: ZamaSDK,
  handles: Hex[],
  attempts = 12,
  delayMs = 2500
): Promise<PublicDecryptResult> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await sdk.decryption.decryptPublicValues(handles);
      // NOTE: the field is `clearValues` (not `values`) — reading the wrong
      // one yields `undefined` and silently decodes as zero.
      const values = handles.map((h) => {
        // Match case-insensitively — casing of returned keys is not guaranteed.
        const key =
          (Object.keys(res.clearValues) as Hex[]).find(
            (k) => k.toLowerCase() === h.toLowerCase()
          ) ?? h;
        return BigInt((res.clearValues[key] ?? 0n) as bigint);
      });
      return {
        values,
        cleartexts: res.abiEncodedClearValues as Hex,
        decryptionProof: res.decryptionProof as Hex,
      };
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastError ?? new Error("Public decryption timed out.");
}
