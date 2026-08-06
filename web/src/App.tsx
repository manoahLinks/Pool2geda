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
import { Notice, Panel, Serial } from "@/components/ui";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { shortAddress } from "@/lib/format";

export default function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  const { members } = usePoolMembers(nonce);
  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const ready = isConnected && !!contracts && !wrongNetwork;

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div>
          <h1 className="display text-2xl leading-none font-semibold">
            Pool<span className="text-bank">2</span>geda
          </h1>
          <p className="serif-caps mt-1.5 text-[9px] text-faint">
            Confidential prize savings · Sepolia
          </p>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" />
      </header>

      <div className="space-y-4">
        {!contracts && (
          <Notice kind="error">
            <p className="font-medium">Contract addresses are not set.</p>
            <p className="mt-1">
              Missing {missingContractEnv.join(", ")}. Copy{" "}
              <code className="bg-ink/8 px-1">web/.env.example</code> to{" "}
              <code className="bg-ink/8 px-1">web/.env</code>, or run the deploy
              script, which fills it in.
            </p>
          </Notice>
        )}

        {contracts && <Hero memberCount={members?.length ?? null} />}

        {wrongNetwork && (
          <Notice kind="error">
            Wrong network. Switch to Sepolia — the encryption protocol only runs
            there.
          </Notice>
        )}

        {contracts && !isConnected && (
          <Panel caption="To subscribe">
            <p className="max-w-lg text-[13.5px] leading-[1.7] text-ink/75">
              Connect a wallet on Sepolia. You will need a little Sepolia ETH
              for gas; the pool&rsquo;s own tokens are issued free by the
              faucet. Nothing you deposit is legible to anyone once it enters.
            </p>
          </Panel>
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

      <footer className="mt-10">
        <div className="rule-double pt-5">
          <h2 className="serif-caps text-[10px] text-bank">
            Terms of disclosure
          </h2>
          <div className="mt-3 grid gap-x-8 gap-y-4 text-[11.5px] leading-[1.65] text-ink/70 sm:grid-cols-2">
            <p>
              <span className="serif-caps text-[9px] text-carmine">Sealed </span>
              Every deposit, balance, and prize, and the identity of each winner
              — concealed from all parties including the contract that pays.
              Odds follow stake multiplied by time held, so a large sum entered
              moments before a draw earns very little.
            </p>
            <p>
              <span className="serif-caps text-[9px] text-ink">Disclosed </span>
              The pool&rsquo;s combined total each round, the draw randomness
              once a round closes, the addresses on the register, the prize, and
              any sum entering or leaving the sealed balance. The randomness and
              the total together still disclose nothing of any single holder.
            </p>
          </div>
        </div>

        {contracts && (
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-ink/10 pt-3">
            <Serial label="POOL" value={shortAddress(contracts.prizePool)} />
            <Serial label="NOTE" value={shortAddress(contracts.confidentialUsd)} />
            <Serial label="ASSET" value={shortAddress(contracts.testUsd)} />
            <span className="ml-auto font-mono text-[9px] tracking-wider text-faint/60">
              SEPOLIA · CHAIN 11155111
            </span>
          </div>
        )}
      </footer>
    </div>
  );
}
