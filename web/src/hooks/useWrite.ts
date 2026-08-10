import { useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { Abi, Address } from "viem";
import { useZamaSdk } from "@/hooks/useZamaSdk";

export type WriteArgs = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

/// Send a write and wait for the receipt. Throws on every failure.
///
/// Deliberately does not catch: callers wrap these in `shell.run`, which owns
/// both the waiting overlay and turning whatever went wrong into one sentence
/// the user can act on. Swallowing errors here would mean every call site
/// growing its own error line again.
export function useWrite() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  return useCallback(
    async (a: WriteArgs) => {
      if (!walletClient || !publicClient) throw new Error("SignerNotConfigured");
      const hash = await walletClient.writeContract({
        address: a.address,
        abi: a.abi,
        functionName: a.functionName,
        args: a.args ?? [],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("Transaction reverted.");
      return rc;
    },
    [walletClient, publicClient]
  );
}

/// Encrypt a plaintext amount in the browser, producing the ciphertext and the
/// zero-knowledge proof that binds it to this contract and this sender.
///
/// This is the 10–14 second step, and the reason it feels so long is that it
/// happens *before* the wallet opens — there is no popup to reassure anyone
/// while it runs. It is also the step that makes the deposit private at all:
/// the plaintext never leaves the tab.
export function useEncrypt() {
  const { address } = useAccount();
  const { getSdk } = useZamaSdk();

  return useCallback(
    async (value: bigint, contractAddress: Address) => {
      if (!address) throw new Error("SignerNotConfigured");
      const sdk = await getSdk();
      const { encryptedValues, inputProof } = await sdk.encrypt({
        values: [{ value, type: "euint64" }],
        contractAddress,
        userAddress: address,
      });
      return { handle: encryptedValues[0], proof: inputProof };
    },
    [address, getSdk]
  );
}
