import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { sepolia } from "@/config/wagmi";
import { contracts, missingContractEnv } from "@/config/contracts";
import { Hero } from "@/components/Hero";
import { PoolLedger } from "@/components/PoolLedger";
import { DepositFlow } from "@/components/DepositFlow";
import { Position } from "@/components/Position";
import { Round } from "@/components/Round";
import { Notice } from "@/components/ui";
import { usePoolMembers } from "@/hooks/usePoolMembers";

export default function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  const { members } = usePoolMembers(nonce);
  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const ready = isConnected && !!contracts && !wrongNetwork;

  return (
    <div className="mx-auto max-w-3xl px-6 pb-20">
      <header className="flex items-center justify-between gap-6 py-6">
        <span className="display text-lg font-bold tracking-tight">
          pool<span className="text-seal">2</span>geda
        </span>
        <ConnectButton showBalance={false} />
      </header>

      {contracts && <Hero memberCount={members?.length ?? null} />}

      <div className="space-y-4">
        {!contracts && (
          <Notice kind="error">
            <p className="font-medium">Contract addresses are not set.</p>
            <p className="mt-1">
              Missing {missingContractEnv.join(", ")}. Copy{" "}
              <code className="rounded bg-black/40 px-1">web/.env.example</code>{" "}
              to <code className="rounded bg-black/40 px-1">web/.env</code>, or
              run the deploy script, which fills it in.
            </p>
          </Notice>
        )}

        {wrongNetwork && (
          <Notice kind="error">
            You're on the wrong network. Switch to Sepolia — the encryption
            protocol only runs there.
          </Notice>
        )}

        {contracts && !isConnected && (
          <div className="rounded-2xl border border-white/[0.08] bg-vault/70 p-6">
            <p className="text-[15px] leading-relaxed text-mist">
              Connect a wallet on Sepolia to join. You'll need a little Sepolia
              ETH for gas — the pool's own tokens are free from the faucet.
            </p>
          </div>
        )}

        {ready && (
          <>
            <PoolLedger refreshKey={nonce} />
            <DepositFlow onDone={refresh} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Position onDone={refresh} />
              <Round onDone={refresh} />
            </div>
          </>
        )}
      </div>

      <footer className="mt-14 border-t border-white/[0.06] pt-6">
        <p className="font-mono text-[11px] tracking-[0.14em] text-mist/50 uppercase">
          What is hidden, and what is not
        </p>
        <div className="mt-3 grid gap-4 text-xs leading-relaxed text-mist/70 sm:grid-cols-2">
          <p>
            <span className="text-reveal/80">Hidden:</span> every deposit,
            balance, and prize — plus who won. The contract cannot read them
            either. Odds follow stake × time held, so a large deposit made just
            before a draw buys almost nothing.
          </p>
          <p>
            <span className="text-white/70">Public:</span> the pool's combined
            total each round, the draw randomness once a round closes,
            participant addresses, the prize, and amounts entering or leaving
            the private balance. Knowing the randomness and the total still
            tells you nothing about any individual.
          </p>
        </div>
      </footer>
    </div>
  );
}
