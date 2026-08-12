import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";
import "solidity-coverage";

// Run 'npx hardhat vars setup' to see the list of variables that need to be set.

// The canonical hardhat/anvil test phrase. The local network ALWAYS uses this
// so runs are deterministic and reproducible across machines.
//
// Deliberately not read from `vars`: `vars.get("MNEMONIC", <default>)` resolves
// against Hardhat's *global* variable store (~/Library/Preferences/hardhat-nodejs
// on macOS), so a MNEMONIC a developer saved for unrelated work silently
// overrides the default here and fails with "Invalid mnemonic" before anything
// compiles. Only Sepolia reads developer-supplied credentials.
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

// CI has no interactive `hardhat vars` store, so a plain environment variable
// wins when one is present. This is how the keeper workflow injects its key —
// and it must be a burner, because the repository is public and the deployer
// key owns the contracts.
const MNEMONIC: string = vars.get("MNEMONIC", TEST_MNEMONIC);
const PRIVATE_KEY_RAW: string =
  process.env.PRIVATE_KEY ?? vars.get("PRIVATE_KEY", "");
const PRIVATE_KEY: string = PRIVATE_KEY_RAW
  ? PRIVATE_KEY_RAW.startsWith("0x")
    ? PRIVATE_KEY_RAW
    : `0x${PRIVATE_KEY_RAW}`
  : "";
const ALCHEMY_API_KEY_SEPOLIA: string =
  process.env.ALCHEMY_API_KEY_SEPOLIA ?? vars.get("ALCHEMY_API_KEY_SEPOLIA", "");
const INFURA_API_KEY: string = vars.get(
  "INFURA_API_KEY",
  "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
);

// Accept either a bare key or a full https URL for ALCHEMY_API_KEY_SEPOLIA.
const SEPOLIA_RPC_URL: string = ALCHEMY_API_KEY_SEPOLIA
  ? ALCHEMY_API_KEY_SEPOLIA.startsWith("http")
    ? ALCHEMY_API_KEY_SEPOLIA
    : `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY_SEPOLIA}`
  : `https://sepolia.infura.io/v3/${INFURA_API_KEY}`;

const sepoliaAccounts = PRIVATE_KEY
  ? [PRIVATE_KEY]
  : { mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10 };

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  etherscan: {
    apiKey: vars.get("ETHERSCAN_API_KEY", ""),
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: TEST_MNEMONIC,
        // The distribution test needs many independent depositors.
        count: 20,
      },
      chainId: 31337,
    },
    anvil: {
      accounts: {
        mnemonic: TEST_MNEMONIC,
        path: "m/44'/60'/0'/0/",
        count: 10,
      },
      chainId: 31337,
      url: "http://localhost:8545",
    },
    sepolia: {
      accounts: sepoliaAccounts,
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: {
        bytecodeHash: "none",
      },
      optimizer: {
        enabled: true,
        runs: 800,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
