import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";

/// Sepolia only. The Zama protocol is not deployed on other testnets, and
/// pointing the app at one would fail deep inside the SDK with an unhelpful
/// error — better to offer a single chain and let RainbowKit surface the
/// network mismatch.
export const wagmiConfig = getDefaultConfig({
  appName: "Pool2geda",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "pool2geda-local",
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(import.meta.env.VITE_SEPOLIA_RPC_URL || undefined),
  },
  ssr: false,
});

export { sepolia };
