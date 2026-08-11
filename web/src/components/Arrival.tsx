import type { ReactNode } from "react";
import { ForeignSeal } from "@/components/Value";
import { Button, Label, Plate } from "@/components/ui";
import { usePool } from "@/hooks/usePool";
import { usePoolMembers } from "@/hooks/usePoolMembers";
import { formatMoney, formatDuration, shortAddress } from "@/lib/format";

/// Three propositions, deliberately not numbered: only the first two are
/// things a saver does, and the third is a property of the system. Numbering
/// them would claim a sequence that isn't there.
const CLAIMS = [
  {
    head: "Your deposit is never at risk",
    body: "Withdraw all of it at any time, including in the middle of a round. Prizes are paid from a separate reserve and never from anyone's capital.",
  },
  {
    head: "Odds are stake multiplied by time",
    body: "The longer money sits here, the better your chances. A large sum dropped in seconds before a draw counts for almost nothing.",
  },
  {
    head: "The winner is never worked out in the open",
    body: "Not by other savers, not by anyone watching the chain, and not by the contract that pays the prize.",
  },
];

const ON_RECORD = [
  "That you joined",
  "The prize each round",
  "When the round closes",
  "The sum you made private",
];
const SEALED = [
  "What you hold",
  "Your chance of winning",
  "Whether you won",
  "What you have won",
];

export function Arrival({ onConnect }: { onConnect: () => void }) {
  const { prize, remaining, epoch } = usePool();
  const { members, error: rosterError } = usePoolMembers(0);
  const shown = members?.slice(0, 6) ?? [];

  return (
    <div className="stagger">
      {/* ── thesis ─────────────────────────────────────────────────────── */}
      {/* No ornament here on purpose. A rosette in this design means one thing —
          "this value is sealed and unreadable" — so drawing one from public
          data would make the language decorative instead of load-bearing. The
          patterns appear further down, where they stand for real ciphertext. */}
      <section className="pt-4 pb-16">
        <h1 className="wide m-0 max-w-[13ch] text-[clamp(40px,7vw,76px)] leading-[0.98] font-bold">
          Savings nobody can read.
        </h1>
        <p className="m-0 mt-7 max-w-[52ch] text-[17px] leading-[1.65] text-slate">
          Put money in and it stays yours — withdraw the lot whenever you like.
          Nobody earns interest here; the interest the pool earns goes to one
          saver each round. Every balance, every chance and every prize is
          encrypted on-chain.
        </p>
        <div className="mt-9">
          <Button size="lg" onClick={onConnect}>
            Connect a wallet
          </Button>
        </div>
      </section>

      {/* ── instrument readout ─────────────────────────────────────────── */}
      <Plate className="mb-16 grid grid-cols-2 gap-y-9 px-9 py-8 sm:grid-cols-4">
        <Readout label="Prize this round">
          {prize !== undefined ? formatMoney(prize) : "—"}
        </Readout>
        <Readout label="Round">
          {epoch !== undefined ? epoch.toString().padStart(3, "0") : "—"}
        </Readout>
        <Readout label="Closes in">
          {remaining !== null ? formatDuration(remaining) : "—"}
        </Readout>
        <Readout label="Savers">{members ? String(members.length) : "—"}</Readout>
      </Plate>

      {/* ── the proof ──────────────────────────────────────────────────── */}
      <section className="mb-16">
        <Label>The register</Label>
        <h2 className="wide m-0 mt-3 mb-3 max-w-[24ch] text-[clamp(24px,3vw,34px)] leading-[1.1] font-semibold">
          Everyone is listed. Every figure is unreadable.
        </h2>
        <p className="m-0 mb-8 max-w-[58ch] text-[15px] leading-[1.65] text-slate">
          These are live balances on Sepolia right now. Each pattern is drawn
          from the actual ciphertext that saver's holding is stored as — public,
          fetchable by anyone, and legible to nobody but its owner.
        </p>
        <Plate className="px-7 py-2">
          {rosterError ? (
            /* Never claim the pool is empty when the register simply could not
               be read — this section's whole job is to be evidence. */
            <div className="py-12 text-center text-[15px] text-slate">
              The register could not be read from this network right now.
            </div>
          ) : members === null ? (
            <div className="py-12 text-center text-[15px] text-slate">
              Reading the register…
            </div>
          ) : shown.length === 0 ? (
            <div className="py-12 text-center text-[15px] text-slate">
              Nobody has deposited yet. The first will appear here — as an
              address, and nothing more.
            </div>
          ) : (
            shown.map((m) => (
              <div
                key={m.address}
                className="flex items-center justify-between gap-6 border-b border-line/60 py-4 last:border-b-0"
              >
                <span className="data text-ink">{shortAddress(m.address)}</span>
                <ForeignSeal handle={m.handle} />
              </div>
            ))
          )}
        </Plate>
      </section>

      {/* ── claims ─────────────────────────────────────────────────────── */}
      <section className="mb-16 grid gap-10 sm:grid-cols-3">
        {CLAIMS.map((c) => (
          <div key={c.head}>
            <h3 className="wide m-0 mb-2.5 text-[17px] leading-[1.25] font-semibold">
              {c.head}
            </h3>
            <p className="m-0 text-[14px] leading-[1.65] text-slate">{c.body}</p>
          </div>
        ))}
      </section>

      {/* ── disclosure ─────────────────────────────────────────────────── */}
      <section className="mb-6">
        <Label>Disclosure</Label>
        <h2 className="wide m-0 mt-3 mb-3 text-[clamp(24px,3vw,34px)] leading-[1.1] font-semibold">
          What is public, stated plainly.
        </h2>
        <p className="m-0 mb-8 max-w-[58ch] text-[15px] leading-[1.65] text-slate">
          Deposits are ordinary public transactions, so joining is visible. No
          amount ever is. A product about disclosure control cannot be vague
          about its own.
        </p>
        <div className="grid gap-px bg-line/60 sm:grid-cols-2">
          <Column title="On the record" items={ON_RECORD} tone="ink" />
          <Column title="Sealed" items={SEALED} tone="brass" />
        </div>
      </section>
    </div>
  );
}

function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="fig mt-3 text-[clamp(30px,3.4vw,40px)] text-ink">{children}</div>
    </div>
  );
}

function Column({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ink" | "brass";
}) {
  return (
    <div className="bg-field px-7 py-7">
      <Label tone={tone}>{title}</Label>
      <ul className="m-0 mt-5 list-none p-0">
        {items.map((i) => (
          <li
            key={i}
            className="border-b border-line/50 py-3 text-[15px] last:border-b-0"
          >
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
