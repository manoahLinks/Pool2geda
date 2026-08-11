import { useState } from "react";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { sepolia } from "@/config/wagmi";
import { contracts, missingContractEnv } from "@/config/contracts";
import { Arrival } from "@/components/Arrival";
import { Setup } from "@/components/Setup";
import { Account } from "@/components/Account";
import { BusyOverlay } from "@/components/BusyOverlay";
import { ResultModal } from "@/components/ResultModal";
import { NoticeBar } from "@/components/ui";
import { useSetup, type SetupStep } from "@/hooks/useSetup";
import { useShell } from "@/lib/shell";
import { shortAddress } from "@/lib/format";

export default function App() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const setup = useSetup();
  const { openConnectModal } = useConnectModal();
  const { busy, notice, result, dismissNotice, closeResult } = useShell();

  const [nonce, setNonce] = useState(0);
  /// Set when a saver who is already set up asks to add more. Nothing else
  /// overrides the flow — the rest is derived from what is on-chain, so the app
  /// cannot show a step that has already been completed.
  const [topUp, setTopUp] = useState(false);

  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const configured = !!contracts;

  const screen: "arrival" | "setup" | "account" = !isConnected
    ? "arrival"
    : topUp || !setup.complete
      ? "setup"
      : "account";

  const step: SetupStep = topUp ? "deposit" : setup.autoStep;

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1100px] items-center gap-6 px-7 pt-8 pb-14">
        <span className="wide mr-auto text-[19px] font-bold">
          Pool<span className="text-brass-deep">2</span>geda
        </span>
        <span className="label hidden text-slate sm:block">Sepolia</span>
        <ConnectButton.Custom>
          {({ openConnectModal: open, openAccountModal, mounted }) => (
            <button
              type="button"
              onClick={isConnected ? openAccountModal : open}
              disabled={!mounted}
              className={
                "wide cursor-pointer rounded-[3px] px-4 py-2.5 text-[13px] font-semibold transition-colors " +
                (isConnected
                  ? "bg-transparent text-ink ring-1 ring-inset ring-line hover:ring-ink"
                  : "bg-ink text-field hover:bg-slate")
              }
            >
              {isConnected && address ? shortAddress(address) : "Connect a wallet"}
            </button>
          )}
        </ConnectButton.Custom>
      </header>

      <main className="mx-auto max-w-[1100px] px-7 pb-24">
        {notice && <NoticeBar notice={notice} onDismiss={dismissNotice} />}

        {!configured && (
          <NoticeBar
            notice={{
              tone: "bad",
              title: "No deployment behind this build",
              body: `Missing ${missingContractEnv.join(", ")}. Copy web/.env.example to web/.env, or run the deploy script, which fills it in.`,
            }}
          />
        )}

        {wrongNetwork && (
          <NoticeBar
            notice={{
              tone: "bad",
              title: "Wrong network",
              body: "This runs on Sepolia — the encryption protocol is not deployed anywhere else. Switch your wallet across and the app opens up.",
            }}
          />
        )}

        {configured && !wrongNetwork && (
          <>
            {screen === "arrival" && (
              <Arrival onConnect={() => openConnectModal?.()} />
            )}

            {screen === "setup" && (
              <Setup
                setup={setup}
                step={step}
                onCancel={topUp ? () => setTopUp(false) : undefined}
                onDeposited={() => {
                  setTopUp(false);
                  setNonce((n) => n + 1);
                }}
              />
            )}

            {screen === "account" && (
              <Account
                refreshKey={nonce}
                onTopUp={() => setTopUp(true)}
                onChanged={() => setNonce((n) => n + 1)}
              />
            )}
          </>
        )}
      </main>

      {contracts && (
        <footer className="mx-auto max-w-[1100px] px-7 pb-14">
          <div className="flex flex-wrap items-center gap-x-10 gap-y-2 border-t border-line pt-5">
            <Serial label="Pool" value={contracts.prizePool} />
            <Serial label="Private token" value={contracts.confidentialUsd} />
            <Serial label="Asset" value={contracts.testUsd} />
            <span className="data ml-auto text-slate">Chain 11155111</span>
          </div>
        </footer>
      )}

      {busy && <BusyOverlay kind={busy.kind} startedAt={busy.startedAt} />}
      {result && <ResultModal result={result} onClose={closeResult} />}
    </div>
  );
}

/// The real addresses in use, printed the way an instrument carries its plate
/// marks. Verifiable, not decorative.
function Serial({ label, value }: { label: string; value: string }) {
  return (
    <a
      href={`https://sepolia.etherscan.io/address/${value}`}
      target="_blank"
      rel="noreferrer"
      className="data text-slate transition-colors hover:text-ink"
    >
      <span className="label mr-2 text-slate">{label}</span>
      {shortAddress(value)}
    </a>
  );
}
