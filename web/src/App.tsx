import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { sepolia } from "@/config/wagmi";
import { useZamaSdk } from "@/hooks/useZamaSdk";
import { contracts, missingContractEnv } from "@/config/contracts";

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function App() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const sdk = useZamaSdk();

  const wrongNetwork = isConnected && chainId !== sepolia.id;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pool2geda</h1>
          <p className="mt-1 max-w-xl text-white/60">
            No-loss prize savings where your balance, your odds, and the winner
            all stay encrypted on-chain.
          </p>
        </div>
        <ConnectButton />
      </header>

      {wrongNetwork && (
        <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          Wrong network — switch your wallet to Sepolia. The Zama protocol is
          only deployed there.
        </div>
      )}

      {!contracts && (
        <div className="mb-6 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          <p className="font-medium">Contract addresses not configured.</p>
          <p className="mt-1 text-rose-200/80">
            Missing: {missingContractEnv.join(", ")}. Copy{" "}
            <code className="rounded bg-black/30 px-1">web/.env.example</code> to{" "}
            <code className="rounded bg-black/30 px-1">web/.env</code>, or deploy
            the contracts — the deploy script writes them for you.
          </p>
        </div>
      )}

      {!isConnected ? (
        <Panel
          title="Connect a wallet"
          subtitle="Sepolia only. You will need a little Sepolia ETH for gas."
        >
          <p className="text-sm text-white/60">
            Once connected you can claim test tokens, deposit confidentially,
            and check whether you won — without revealing your balance to
            anyone, including this app.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="1 · Get tUSD" subtitle="Public faucet, 1,000 per hour">
            <p className="text-sm text-white/50">Faucet UI — next step.</p>
          </Panel>
          <Panel
            title="2 · Wrap to cUSD"
            subtitle="Public amount — this is the confidentiality boundary"
          >
            <p className="text-sm text-white/50">Wrap UI — next step.</p>
          </Panel>
          <Panel title="3 · Deposit" subtitle="Encrypted from here on">
            <p className="text-sm text-white/50">Deposit UI — next step.</p>
          </Panel>
          <Panel title="My pool" subtitle="Decrypt with your wallet">
            <p className="text-sm text-white/50">
              SDK {sdk ? "ready" : "initialising"} — balances UI next step.
            </p>
          </Panel>
        </div>
      )}

      <footer className="mt-12 text-xs leading-relaxed text-white/35">
        <p>
          Encrypted: deposits, balances, time-weighted stake, winnings, and who
          won — including from this contract.
        </p>
        <p className="mt-1">
          Public by design: the pool&rsquo;s aggregate stake per round, the draw
          randomness after each round closes, participant addresses, the prize
          amount, and wrap/unwrap amounts.
        </p>
      </footer>
    </div>
  );
}
