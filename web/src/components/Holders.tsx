import { useAccount } from "wagmi";
import { Label, Plate } from "@/components/ui";
import { Seal, ForeignSeal } from "@/components/Value";
import type { Secret } from "@/hooks/useSecret";
import type { Member } from "@/hooks/usePoolMembers";
import { shortAddress } from "@/lib/format";

/// The register of savers.
///
/// This is the product's whole argument made without a word: a complete,
/// public, verifiable list of everyone in the pool in which every single figure
/// is unreadable. Each pattern is cut from that saver's actual holding
/// ciphertext, so the list is not concealing the numbers — it is showing them,
/// in the only form anyone but their owner can ever have them.
export function Holders({
  members,
  error,
  mine,
}: {
  /// `null` means not known yet — never "nobody".
  members: Member[] | null;
  error?: string | null;
  mine: Secret;
}) {
  const { address } = useAccount();

  return (
    <section>
      <Label>The register</Label>
      <h2 className="wide m-0 mt-3 mb-3 text-[clamp(22px,2.6vw,30px)] leading-[1.1] font-semibold">
        Everyone here, and not one figure among them.
      </h2>
      <p className="m-0 mb-8 max-w-[58ch] text-[15px] leading-[1.65] text-slate">
        Joining is a public transaction, so membership is visible. Only your own
        line will ever open, and only to your key.
      </p>

      <Plate className="px-9 py-2">
        {error ? (
          /* Say the register could not be read. Showing an empty list here
             would be a lie about the pool, not a gap in the UI. */
          <div className="mx-auto max-w-[46ch] py-14 text-center text-[15px] text-slate">
            The register could not be read. Your own holding above is unaffected —
            it comes straight from the contract.
            <span className="data mt-3 block text-slate">{error}</span>
          </div>
        ) : members === null ? (
          <div className="py-14 text-center text-[15px] text-slate">
            Reading the register…
          </div>
        ) : members.length === 0 ? (
          <div className="py-14 text-center text-[15px] text-slate">
            No holdings are entered yet. The first will appear here — as an
            address, and nothing more.
          </div>
        ) : (
          members.map((m, i) => {
            const isMine = m.address.toLowerCase() === address?.toLowerCase();
            return (
              <div
                key={m.address}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line/60 py-5 last:border-b-0"
              >
                <span className="data w-9 shrink-0 text-slate tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={
                    "data min-w-0 flex-1 " + (isMine ? "text-ink" : "text-slate")
                  }
                >
                  {shortAddress(m.address)}
                  {isMine && (
                    <span className="label ml-3 text-brass-deep">You</span>
                  )}
                </span>
                <span className="shrink-0">
                  {isMine ? (
                    <Seal
                      handle={m.handle}
                      secret={mine}
                      label="your holding"
                      scale="row"
                    />
                  ) : (
                    <ForeignSeal handle={m.handle} />
                  )}
                </span>
              </div>
            );
          })
        )}
      </Plate>
    </section>
  );
}
