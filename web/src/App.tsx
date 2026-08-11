import { useState } from "react";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useReadContract, useSwitchChain } from "wagmi";
import type { Abi, Hex } from "viem";
import { sepolia } from "@/config/wagmi";
import { contracts, missingContractEnv } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { Landing } from "@/components/Landing";
import { PoolTab } from "@/components/PoolTab";
import { AccountTab } from "@/components/AccountTab";
import { ActionModal, type Action } from "@/components/ActionModal";
import { BusyOverlay } from "@/components/BusyOverlay";
import { ResultModal } from "@/components/ResultModal";
import { Badge, Button, NoticeBar } from "@/components/ui";
import { useSetup } from "@/hooks/useSetup";
import { useSecret } from "@/hooks/useSecret";
import { useShell } from "@/lib/shell";
import { shortAddress } from "@/lib/format";

const poolAbi = prizePoolAbi as unknown as Abi;
type Tab = "pool" | "account";

export default function App() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const setup = useSetup();
  const { busy, notice, result, dismissNotice, closeResult, showResult } = useShell();

  const [tab, setTab] = useState<Tab>("pool");
  const [nonce, setNonce] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  /// Anything that changed on-chain state: re-read the ciphertext handles and
  /// nudge the panels. Awaited so a caller can decrypt straight afterwards and
  /// be sure it is reading the value it just created.
  const bump = async () => {
    setNonce((n) => n + 1);
    await Promise.all([refetchShares(), refetchWinnings(), setup.refetchAll()]);
  };

  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const c = contracts;

  // Hoisted so the register row and the account panel share one decrypted
  // value — unsealing in either place reveals both, which is what a user
  // expects from the same number shown twice.
  // These handles CHANGE on every write that touches them — a deposit, a
  // withdrawal, a prize check. Reading them once is the bug that made a real
  // win look like a loss: `checkPrize` credits the prize and rewrites
  // `_winnings`, but the page still held the pre-check handle, which is the
  // zero handle for a first-time winner. `useSecret` short-circuits a zero
  // handle straight to 0 without calling the relayer, so "reveal result"
  // reported "not this round" instantly and confidently, while 5 cUSD sat in
  // the contract.
  //
  // Refetched on every state change via `bump`, plus a slow poll so a round
  // settled by somebody else still lands.
  const { data: sharesHandle, refetch: refetchShares } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "sharesOf",
    args: address ? [address] : undefined,
    query: { enabled: !!c && !!address, refetchInterval: 15_000 },
  });
  const { data: winningsHandle, refetch: refetchWinnings } = useReadContract({
    address: c?.prizePool,
    abi: poolAbi,
    functionName: "winningsOf",
    args: address ? [address] : undefined,
    query: { enabled: !!c && !!address, refetchInterval: 15_000 },
  });

  const shares = useSecret(sharesHandle as Hex | undefined, c?.prizePool ?? "0x");
  const walletBalance = useSecret(setup.balanceHandle, c?.confidentialUsd ?? "0x");
  const winnings = useSecret(winningsHandle as Hex | undefined, c?.prizePool ?? "0x");

  /// Decrypt winnings and say what it means. A positive figure after a check is
  /// a win; zero is not.
  async function revealResult() {
    // Re-read first. The handle written by `checkPrize` is only a few seconds
    // old and the page may still be holding the one from before it.
    const { data: fresh } = await refetchWinnings();
    const v = await winnings.reveal(fresh as Hex | undefined);
    if (v === null) return;
    showResult({ won: v > 0n, amount: v, round: "" });
  }

  return (
    <div className="min-h-screen">
      {/* ── nav ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1080px] items-center gap-4 px-5 py-3.5">
          <button
            type="button"
            onClick={() => setTab("pool")}
            className="flex cursor-pointer items-center gap-2.5 font-extrabold"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-[15px] text-white">
              P
            </span>
            <span className="text-[17px]">Pool2geda</span>
          </button>

          {isConnected && !wrongNetwork && (
            <nav className="ml-4 hidden gap-1 sm:flex">
              {(["pool", "account"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    "cursor-pointer rounded-ctl px-4 py-2 text-[14px] font-bold capitalize transition-colors " +
                    (tab === t
                      ? "bg-surface-2 text-text"
                      : "text-muted hover:text-text")
                  }
                >
                  {t}
                </button>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden sm:block">
              <Badge tone={wrongNetwork ? "danger" : "neutral"}>
                {wrongNetwork ? "Wrong network" : "Sepolia"}
              </Badge>
            </span>
            <ConnectButton.Custom>
              {({ openConnectModal: open, openAccountModal, mounted }) => (
                <button
                  type="button"
                  onClick={isConnected ? openAccountModal : open}
                  disabled={!mounted}
                  className={
                    "cursor-pointer rounded-ctl px-4 py-2 text-[13px] font-bold transition-colors " +
                    (isConnected
                      ? "border border-line bg-surface-2 text-text hover:border-accent-soft"
                      : "bg-accent text-white hover:bg-accent-soft")
                  }
                >
                  {isConnected && address ? shortAddress(address) : "Connect wallet"}
                </button>
              )}
            </ConnectButton.Custom>
          </div>
        </div>

        {/* Tabs drop to their own row on narrow screens rather than crowding
            the wallet button off the edge. */}
        {isConnected && !wrongNetwork && (
          <div className="mx-auto flex max-w-[1080px] gap-1 px-5 pb-3 sm:hidden">
            {(["pool", "account"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  "flex-1 cursor-pointer rounded-ctl px-4 py-2 text-[14px] font-bold capitalize transition-colors " +
                  (tab === t ? "bg-surface-2 text-text" : "text-muted")
                }
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1080px] px-5 pt-7 pb-20">
        {notice && <NoticeBar notice={notice} onDismiss={dismissNotice} />}

        {!c && (
          <NoticeBar
            notice={{
              tone: "bad",
              title: "No deployment configured",
              body: `Missing ${missingContractEnv.join(", ")}. Copy web/.env.example to web/.env, or run the deploy script, which fills it in.`,
            }}
          />
        )}

        {wrongNetwork && (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-7 text-center">
            <h2 className="m-0 text-[20px] font-extrabold text-danger">
              Switch to Sepolia
            </h2>
            <p className="mx-auto m-0 mt-2 mb-5 max-w-[46ch] text-[14px] text-muted">
              The Zama encryption protocol only runs on Sepolia, so the app can’t
              read or write anything from the network you’re on.
            </p>
            <Button onClick={() => switchChain({ chainId: sepolia.id })}>
              Switch network
            </Button>
          </div>
        )}

        {c && !wrongNetwork && (
          <>
            {!isConnected && <Landing onConnect={() => openConnectModal?.()} />}

            {isConnected && tab === "pool" && (
              <PoolTab
                refreshKey={nonce}
                onChanged={bump}
                shares={shares}
                onOpenResult={() => {
                  setTab("account");
                  void revealResult();
                }}
              />
            )}

            {isConnected && tab === "account" && (
              <AccountTab
                setup={setup}
                shares={shares}
                winnings={winnings}
                sharesHandle={sharesHandle as Hex | undefined}
                winningsHandle={winningsHandle as Hex | undefined}
                onChanged={bump}
                onOpen={setAction}
                walletBalance={walletBalance}
              />
            )}
          </>
        )}
      </main>

      {c && (
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[12px] text-muted">
            <a
              href={`https://sepolia.etherscan.io/address/${c.prizePool}`}
              target="_blank"
              rel="noreferrer"
              className="mono transition-colors hover:text-text"
            >
              Pool {shortAddress(c.prizePool)}
            </a>
            <a
              href={`https://sepolia.etherscan.io/address/${c.confidentialUsd}`}
              target="_blank"
              rel="noreferrer"
              className="mono transition-colors hover:text-text"
            >
              cUSD {shortAddress(c.confidentialUsd)}
            </a>
            <a
              href="https://github.com/manoahLinks/Pool2geda"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-text"
            >
              Source
            </a>
            <span className="ml-auto">Testnet only · tokens have no value</span>
          </div>
        </footer>
      )}

      {action && (
        <ActionModal
          action={action}
          onAction={setAction}
          onClose={() => setAction(null)}
          onDone={bump}
          knownStake={shares.value}
        />
      )}
      {busy && <BusyOverlay kind={busy.kind} startedAt={busy.startedAt} />}
      {result && <ResultModal result={result} onClose={closeResult} />}
    </div>
  );
}
