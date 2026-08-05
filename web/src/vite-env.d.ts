/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEST_USD_ADDRESS?: string;
  readonly VITE_CONFIDENTIAL_USD_ADDRESS?: string;
  readonly VITE_PRIZE_POOL_ADDRESS?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
