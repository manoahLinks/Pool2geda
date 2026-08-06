import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { sepolia } from "@/config/wagmi";
import { contracts, missingContractEnv } from "@/config/contracts";
import { Faucet, Wrap } from "@/components/Onramp";
import { Deposit } from "@/components/Deposit";
import { DrawPanel } from "@/components/DrawPanel";
import { MyPool } from "@/components/MyPool";
import { Notice } from "@/components/ui";

export default function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  // Bumped after any write so sibling panels re-read the chain.
  const [, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  const wrongNetwork = isConnected && chainId !== sepolia.id;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pool2geda</h1>
          <p className="mt-1 max-w-xl text-white/60">
            No-loss prize savings where your balance, your odds, and the winner
            all stay encrypted on-chain.
          </p>
        </div>
        <ConnectButton />
      </header>

      {!contracts && (
        <div className="mb-6">
          <Notice kind="error">
            <p className="font-medium">Contract addresses not configured.</p>
            <p className="mt-1">
              Missing: {missingContractEnv.join(", ")}. Copy{" "}
              <code className="rounded bg-black/30 px-1">web/.env.example</code>{" "}
              to <code className="rounded bg-black/30 px-1">web/.env</code>, or
              deploy the contracts — the deploy script writes them for you.
            </p>
          </Notice>
        </div>
      )}

      {wrongNetwork && (
        <div className="mb-6">
          <Notice kind="error">
            Wrong network — switch your wallet to Sepolia. The Zama protocol is
            only deployed there.
          </Notice>
        </div>
      )}

      {!isConnected || !contracts ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">
            Connect a wallet
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
            Sepolia only, and you will need a little Sepolia ETH for gas. Once
            connected you can claim test tokens, deposit confidentially, and
            check whether you won — without revealing your balance to anyone,
            including this app.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Faucet onDone={refresh} />
          <Wrap onDone={refresh} />
          <Deposit onDone={refresh} />
          <DrawPanel onDone={refresh} />
          <div className="md:col-span-2">
            <MyPool onDone={refresh} />
          </div>
        </div>
      )}

      <footer className="mt-12 space-y-2 text-xs leading-relaxed text-white/35">
        <p>
          <span className="text-white/55">Encrypted:</span> deposits, balances,
          time-weighted stake, winnings, and who won — including from the
          contract itself.
        </p>
        <p>
          <span className="text-white/55">Public by design:</span> the pool
          aggregate per round, the draw randomness once a round closes,
          participant addresses, the prize amount, and wrap/unwrap amounts.
          Knowing the randomness and the total still reveals nothing about any
          individual.
        </p>
        <p>
          Odds are proportional to stake × time held, so a large deposit made
          just before a draw buys almost nothing.
        </p>
      </footer>
    </div>
  );
}
