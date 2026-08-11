import type { Abi } from "viem";
import { Badge, Button, Card } from "@/components/ui";
import { useWrite } from "@/hooks/useWrite";
import type { useSetup } from "@/hooks/useSetup";
import { contracts, OPERATOR_EXPIRY } from "@/config/contracts";
import { confidentialUsdAbi } from "@/abi/confidentialUsd";
import { formatDuration } from "@/lib/format";
import { useShell } from "@/lib/shell";

const cusdAbi = confidentialUsdAbi as unknown as Abi;

/// Two transactions between an empty wallet and a first deposit.
///
/// It used to be four: get a public token, approve it, wrap it, then allow the
/// pool. The wrap step is gone because the asset is confidential from birth —
/// which also removed the only place a per-user amount was ever published.
///
/// Shown as a checklist rather than a wizard: both steps visible at once, each
/// ticking off as the chain confirms, and the card disappears when setup is
/// done. A wizard hides how much is left, which is the anxiety that makes
/// people abandon onboarding.
export function GetStarted({
  setup,
  onDone,
}: {
  setup: ReturnType<typeof useSetup>;
  onDone: () => void | Promise<void>;
}) {
  const c = contracts!;
  const { run } = useShell();
  const write = useWrite();

  async function faucet() {
    const ok = await run("tx", () =>
      write({ address: c.confidentialUsd, abi: cusdAbi, functionName: "faucet" })
    );
    if (ok) {
      await setup.refetchAll();
      onDone();
    }
  }

  async function allow() {
    const ok = await run("tx", () =>
      write({
        address: c.confidentialUsd,
        abi: cusdAbi,
        functionName: "setOperator",
        args: [c.prizePool, BigInt(OPERATOR_EXPIRY)],
      })
    );
    if (ok) {
      await setup.refetchAll();
      onDone();
    }
  }

  const doneCount = [setup.done.faucet, setup.done.allow].filter(Boolean).length;

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="m-0 text-[18px] font-extrabold">Get started</h2>
        <Badge tone="accent">{doneCount}/2</Badge>
      </div>
      <p className="m-0 mb-6 text-[14px] text-muted">
        Two one-off transactions. The tokens are free and encrypted from the
        moment they exist.
      </p>

      <Step
        n={1}
        title="Get confidential tokens"
        body="Mints you 1,000 cUSD, once an hour. The amount is a fixed public constant — the same for everyone — so the only thing anyone learns is that you claimed. Your balance is encrypted from the start."
        done={setup.done.faucet}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={faucet} disabled={setup.cooldown > 0}>
            {setup.cooldown > 0
              ? `Wait ${formatDuration(setup.cooldown)}`
              : "Get 1,000 cUSD"}
          </Button>
          <span className="text-[13px] text-muted">One confirmation</span>
        </div>
      </Step>

      <Step
        n={2}
        title="Allow the pool"
        body="Lets the pool move confidential tokens on your behalf when you deposit. It still cannot read your balance, you can withdraw everything at any time, and this is revocable."
        done={setup.done.allow}
        last
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={allow}>
            Allow the pool
          </Button>
          <span className="text-[13px] text-muted">One confirmation</span>
        </div>
      </Step>
    </Card>
  );
}

function Step({
  n,
  title,
  body,
  done,
  children,
  last,
}: {
  n: number;
  title: string;
  body: string;
  done: boolean;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "" : "mb-5 border-b border-line pb-5"}>
      <div className="flex gap-4">
        <div
          className={
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold " +
            (done ? "bg-mint text-bg" : "bg-surface-2 text-muted")
          }
        >
          {done ? "✓" : n}
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={
              "m-0 text-[15px] font-bold " + (done ? "text-muted line-through" : "")
            }
          >
            {title}
          </h3>
          {!done && (
            <>
              <p className="m-0 mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-muted">
                {body}
              </p>
              <div className="mt-4">{children}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
