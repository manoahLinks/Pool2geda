import { Badge, Button, Card } from "@/components/ui";
import { ForeignValue } from "@/components/Value";
import { usePool } from "@/hooks/usePool";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { formatMoney, formatDuration, shortAddress } from "@/lib/format";

const FEATURES = [
  {
    icon: "🔒",
    title: "Nobody sees your balance",
    body: "Deposits, odds and winnings are encrypted onchain with FHE. Not other savers, not chain watchers, not even the contract paying out.",
  },
  {
    icon: "🎲",
    title: "Fair, weighted draws",
    body: "Randomness is generated onchain by the coprocessor and compared against your encrypted balance. No offchain RNG, no way to resample.",
  },
  {
    icon: "↩︎",
    title: "You can’t lose your deposit",
    body: "Prizes come from a separate yield reserve, never from anyone’s capital. Withdraw the lot whenever you like, mid-round included.",
  },
];

export function Landing({ onConnect }: { onConnect: () => void }) {
  const { prize, prizeCeiling, remaining, epoch } = usePool();
  const { members, error } = usePoolMembers(0);
  const preview = members?.slice(0, 5) ?? [];

  return (
    <div className="stagger">
      {/* ── hero ──────────────────────────────────────────────────────── */}
      <section className="pt-10 pb-12 text-center sm:pt-16">
        <div className="mb-6 flex justify-center">
          <Badge tone="accent">Powered by Zama FHE · Sepolia</Badge>
        </div>
        <h1 className="m-0 mx-auto max-w-[16ch] text-[clamp(36px,6.5vw,64px)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          Save money.{" "}
          <span className="text-accent-soft">Win prizes.</span>{" "}
          <span className="text-mint">Stay private.</span>
        </h1>
        <p className="mx-auto m-0 mt-6 max-w-[52ch] text-[17px] leading-relaxed text-muted">
          Deposit into a shared prize pool and you keep every cent — the pool’s
          yield goes to one saver each round instead of paying everyone interest.
          Your balance and your odds stay encrypted onchain.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={onConnect}>
            Connect wallet
          </Button>
          <Button size="lg" variant="ghost" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>
            How it works
          </Button>
        </div>
      </section>

      {/* ── live stats ────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-6 py-5">
          <div className="label">Prize this round</div>
          <div className="num mt-2 text-[32px] leading-none font-extrabold text-mint">
            {prize !== undefined ? formatMoney(prize) : "—"}
            <span className="ml-2 text-[15px] font-bold">cUSD</span>
          </div>
          {/* The prize accrues with the clock, so it is smaller early in a
              round. Showing the ceiling alone would overstate every round. */}
          {prizeCeiling !== undefined && (
            <div className="mt-1.5 text-[13px] text-muted">
              Growing · up to {formatMoney(prizeCeiling)}
            </div>
          )}
        </Card>
        <Card className="px-6 py-5">
          <div className="label">Next draw</div>
          <div className="num mt-2 text-[32px] leading-none font-extrabold">
            {remaining !== null ? formatDuration(remaining) : "—"}
          </div>
        </Card>
        <Card className="px-6 py-5">
          <div className="label">Savers · Round</div>
          <div className="num mt-2 text-[32px] leading-none font-extrabold">
            {members ? members.length : "—"}
            <span className="ml-2 text-[15px] font-bold text-muted">
              · #{epoch?.toString() ?? "—"}
            </span>
          </div>
        </Card>
      </div>

      {/* ── the proof ─────────────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="m-0 text-center text-[clamp(24px,3.4vw,32px)] font-extrabold">
          Everyone is listed. Nothing is readable.
        </h2>
        <p className="mx-auto m-0 mt-3 mb-7 max-w-[56ch] text-center text-[15px] leading-relaxed text-muted">
          These are live balances on Sepolia right now. Each pattern is generated
          from the actual ciphertext that saver’s deposit is stored as — public,
          fetchable by anyone, readable by nobody but its owner.
        </p>
        <Card className="overflow-hidden">
          {error ? (
            <div className="px-6 py-12 text-center text-[14px] text-muted">
              Couldn’t read the register from this network right now.
            </div>
          ) : members === null ? (
            <div className="px-6 py-12 text-center text-[14px] text-muted">
              Loading savers…
            </div>
          ) : preview.length === 0 ? (
            <div className="px-6 py-12 text-center text-[14px] text-muted">
              No deposits yet — the first saver will appear here as an address,
              and nothing more.
            </div>
          ) : (
            preview.map((m, i) => (
              <div
                key={m.address}
                className={
                  "flex items-center justify-between gap-4 px-6 py-4 " +
                  (i ? "border-t border-line" : "")
                }
              >
                <span className="mono truncate">{shortAddress(m.address)}</span>
                <ForeignValue handle={m.handle} />
              </div>
            ))
          )}
        </Card>
      </section>

      {/* ── how it works ──────────────────────────────────────────────── */}
      <section id="how" className="mt-14 scroll-mt-24">
        <h2 className="m-0 mb-7 text-center text-[clamp(24px,3.4vw,32px)] font-extrabold">
          How it works
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="p-6">
              <div className="text-[22px]">{f.icon}</div>
              <h3 className="m-0 mt-3 text-[16px] font-extrabold">{f.title}</h3>
              <p className="m-0 mt-2 text-[14px] leading-relaxed text-muted">
                {f.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── disclosure ────────────────────────────────────────────────── */}
      <section className="mt-14 mb-6">
        <Card className="p-7">
          <h2 className="m-0 text-[19px] font-extrabold">
            What’s public, stated plainly
          </h2>
          <p className="m-0 mt-2 mb-6 max-w-[62ch] text-[14px] leading-relaxed text-muted">
            Deposits are ordinary transactions, so joining is visible. No amount
            ever is. An app about disclosure control shouldn’t be vague about its
            own.
          </p>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <div className="label mb-3">Visible to anyone</div>
              {["That you joined", "The prize each round", "When the round closes", "The sum you made private"].map(
                (t) => (
                  <div key={t} className="border-t border-line py-2.5 text-[14px]">
                    {t}
                  </div>
                )
              )}
            </div>
            <div>
              <div className="label mb-3" style={{ color: "var(--color-mint)" }}>
                Encrypted
              </div>
              {["Your balance", "Your odds of winning", "Whether you won", "What you have won"].map((t) => (
                <div key={t} className="border-t border-line py-2.5 text-[14px]">
                  {t}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
