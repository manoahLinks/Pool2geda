import { ZamaSDK, indexedDBStorage } from "@zama-fhe/sdk";
import { createConfig } from "@zama-fhe/sdk/viem";
import { sepolia } from "@zama-fhe/sdk/chains";
import { web } from "@zama-fhe/sdk/web";
import type { PublicClient, WalletClient } from "viem";

/// Build the SDK from wagmi's viem clients.
///
/// Two things differ from the legacy `@zama-fhe/relayer-sdk`, and both matter:
///
/// 1. Construction is SYNCHRONOUS. The old `createInstance` was async and had
///    to be awaited before any UI could render, which is why older codebases
///    thread a loading state through everything. Here a `useMemo` is enough.
/// 2. The EIP-712 permit flow is internal. `decryptValues` prompts for one
///    signature, caches the permit in `storage`, and reuses it — no manual
///    keypair generation, `createEIP712`, or signature juggling.
///
/// `createConfig` must come from the adapter matching your client library:
/// `/viem` takes viem clients, `/ethers` takes an EIP-1193 provider or signer.
/// Mixing them fails at runtime, not compile time.
export function buildZamaSdk(
  publicClient: PublicClient,
  walletClient: WalletClient
): ZamaSDK {
  return new ZamaSDK(
    createConfig({
      chains: [sepolia],
      publicClient,
      walletClient,
      // Lets the SDK observe accountsChanged / disconnect. Without it, switching
      // accounts silently keeps using a stale signer and decryption fails with
      // a confusing authorization error.
      ethereum: (globalThis as { ethereum?: never }).ethereum,
      // Persists permits across reloads so users are not re-prompted to sign.
      storage: indexedDBStorage,
      relayers: { [sepolia.id]: web() },
    })
  );
}

export { sepolia as zamaSepolia };
