import type { ZamaSDK } from "@zama-fhe/sdk";
import type { PublicClient, WalletClient } from "viem";

/// Load the Zama SDK on first use, not on page load.
///
/// The imports below are dynamic on purpose. A static import pulls the SDK's
/// JS into the entry chunk, so every visitor pays for it before they can see
/// the page — including anyone who only wants to read the register. Nothing
/// here is needed until someone encrypts or decrypts, which is always behind a
/// deliberate click.
///
/// (The heavy part — ~3.9 MB of tfhe and kms_lib WASM — is already deferred by
/// the SDK's own internal dynamic imports. This defers the shell around it.)
///
/// Two things differ from the legacy `@zama-fhe/relayer-sdk`, and both matter:
///
/// 1. Construction is SYNCHRONOUS once loaded. The old `createInstance` was
///    async and had to be awaited before any UI could render, which is why
///    older codebases thread a loading state through everything.
/// 2. The EIP-712 permit flow is internal. `decryptValues` prompts for one
///    signature, caches the permit, and reuses it — no manual keypair
///    generation, `createEIP712`, or signature juggling.
///
/// `createConfig` must come from the adapter matching your client library:
/// `/viem` takes viem clients, `/ethers` takes an EIP-1193 provider or signer.
/// Mixing them fails at runtime, not compile time.

let cached: { key: string; sdk: ZamaSDK } | null = null;
let inflight: { key: string; promise: Promise<ZamaSDK> } | null = null;

function keyFor(publicClient: PublicClient, walletClient: WalletClient): string {
  return `${walletClient.account?.address ?? "-"}@${publicClient.chain?.id ?? "-"}`;
}

export async function loadZamaSdk(
  publicClient: PublicClient,
  walletClient: WalletClient
): Promise<ZamaSDK> {
  const key = keyFor(publicClient, walletClient);
  if (cached?.key === key) return cached.sdk;
  // Dedupe concurrent callers — two panels can ask at the same moment, and
  // building twice would discard the first instance's cached permits.
  if (inflight?.key === key) return inflight.promise;

  const promise = (async () => {
    const [core, viemAdapter, chains, transport] = await Promise.all([
      import("@zama-fhe/sdk"),
      import("@zama-fhe/sdk/viem"),
      import("@zama-fhe/sdk/chains"),
      import("@zama-fhe/sdk/web"),
    ]);

    const sdk = new core.ZamaSDK(
      viemAdapter.createConfig({
        chains: [chains.sepolia],
        publicClient,
        walletClient,
        // Lets the SDK observe accountsChanged / disconnect. Without it,
        // switching accounts silently keeps using a stale signer and
        // decryption fails with a confusing authorization error.
        ethereum: (globalThis as { ethereum?: never }).ethereum,
        // Persists permits across reloads so users are not re-prompted to sign.
        storage: core.indexedDBStorage,
        relayers: { [chains.sepolia.id]: transport.web() },
      })
    );

    cached = { key, sdk };
    inflight = null;
    return sdk;
  })();

  inflight = { key, promise };
  try {
    return await promise;
  } catch (e) {
    // Don't cache a failed load — a flaky network shouldn't wedge the app.
    if (inflight?.key === key) inflight = null;
    throw e;
  }
}
