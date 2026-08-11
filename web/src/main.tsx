import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { wagmiConfig } from "@/config/wagmi";
import { ShellProvider } from "@/lib/shell";
import App from "@/App";
import "@/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/// The wallet modal is the one surface this app does not draw itself, so it is
/// themed to sit inside the page rather than arrive from a different product.
const walletTheme = darkTheme({
  accentColor: "#6d4aff",
  accentColorForeground: "#ffffff",
  borderRadius: "medium",
  fontStack: "system",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={walletTheme}>
          <ShellProvider>
            <App />
          </ShellProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
