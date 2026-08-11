import type { Abi, Hex } from "viem";
import { Badge, Button, Card } from "@/components/ui";
import { Value } from "@/components/Value";
import { GetStarted } from "@/components/GetStarted";
import type { Secret } from "@/hooks/useSecret";
import type { useSetup } from "@/hooks/useSetup";
import { useWrite } from "@/hooks/useWrite";
import { contracts } from "@/config/contracts";
import { prizePoolAbi } from "@/abi/prizePool";
import { isZeroHandle } from "@/lib/decrypt";
import { formatMoney } from "@/lib/format";
import { useShell } from "@/lib/shell";
import type { Action } from "@/components/ActionModal";

const poolAbi = prizePoolAbi as unknown as Abi;

/// Everything about this wallet: setup if it is not finished, then the position
/// and whatever has been won.
export function AccountTab({
  setup,
  shares,
  winnings,
  sharesHandle,
  winningsHandle,
  onChanged,
  onOpen,
  walletBalance,
}: {
  setup: ReturnType<typeof useSetup>;
  shares: Secret;
  winnings: Secret;
  sharesHandle?: Hex;
  winningsHandle?: Hex;
  onChanged: () => void;
  onOpen: (a: Action) => void;
  /// The wallet's own confidential balance — what a deposit is drawn from.
  walletBalance: Secret;
}) {
  const c = contracts!;
  const { run, notify } = useShell();
  const write = useWrite();

  const hasDeposited = !isZeroHandle(sharesHandle);
  const hasWinnings = !isZeroHandle(winningsHandle);

  async function claim() {
    const ok = await run("tx", () =>
      write({ address: c.prizePool, abi: poolAbi, functionName: "claim" })
    );
    if (!ok) return;
    winnings.hide();
    onChanged();
    notify({
      tone: "good",
      title: "Prize moved",
      body: "It is part of your private balance now, and nothing onchain records that it landed with you.",
    });
  }

  return (
    <div className="stagger space-y-5">
      {!setup.complete && <GetStarted setup={setup} onDone={onChanged} />}

      {/* ── position ──────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label">Your deposit</div>
            <div className="mt-4">
              {hasDeposited ? (
                <Value
                  handle={sharesHandle}
                  secret={shares}
                  label="your deposit"
                  size="lg"
                />
              ) : (
                <div className="text-[clamp(28px,5vw,40px)] leading-none font-extrabold text-muted">
                  Nothing yet
                </div>
              )}
            </div>
          </div>
          <Badge tone="mint">Encrypted onchain</Badge>
        </div>

        <p className="m-0 mt-5 max-w-[56ch] text-[14px] leading-relaxed text-muted">
          {hasDeposited
            ? "Your odds grow with how much you hold and how long you hold it. Withdraw the full amount at any time, including mid-round."
            : "Deposit to join the draw. Your balance is encrypted the moment it lands, and your odds start counting from that second."}
        </p>

        {/* What is in the wallet, as opposed to in the pool. Encrypted too, so
            it needs the same decrypt affordance. */}
        {setup.hasTokens && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-ctl border border-line bg-bg px-4 py-3.5">
            <span className="text-[13px] font-bold text-muted">
              In your wallet
            </span>
            <Value
              handle={setup.balanceHandle}
              secret={walletBalance}
              label="your wallet balance"
              size="sm"
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" onClick={() => onOpen("deposit")} disabled={!setup.complete}>
            Deposit
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={() => onOpen("withdraw")}
            disabled={!hasDeposited}
          >
            Withdraw
          </Button>
        </div>
        {!setup.complete && (
          <p className="m-0 mt-3 text-[13px] text-muted">
            Finish the two steps above to deposit.
          </p>
        )}
      </Card>

      {/* ── winnings ──────────────────────────────────────────────────── */}
      {hasWinnings && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="label">Unclaimed winnings</div>
              <div className="mt-4">
                <Value
                  handle={winningsHandle}
                  secret={winnings}
                  label="your winnings"
                />
              </div>
            </div>
            {winnings.value !== null && winnings.value > 0n && (
              <Button variant="mint" onClick={claim}>
                Claim {formatMoney(winnings.value)} cUSD
              </Button>
            )}
          </div>
          <p className="m-0 mt-4 max-w-[56ch] text-[14px] leading-relaxed text-muted">
            Only your key opens this. Claiming moves it into your private balance
            by confidential transfer, so the payout is encrypted end to end.
          </p>
        </Card>
      )}
    </div>
  );
}
