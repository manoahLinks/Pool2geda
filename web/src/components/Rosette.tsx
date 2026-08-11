import { useMemo } from "react";

/// A rosette cut from a real on-chain value.
///
/// The pattern is a stack of hypotrochoids whose tooth count, offset and phase
/// are read straight out of the ciphertext handle the value is stored as. Two
/// different balances can never draw the same figure, and no figure can be read
/// back into a number — which is the same trick guilloche does on a banknote,
/// for the same reason.
///
/// This is the only ornament in the app, and it is never decorative: wherever
/// one appears, it is standing in for a specific encrypted value.

/// 16-bit chunks of the handle, used as the parameter tape.
function seeds(raw: string): number[] {
  const hex = raw.replace(/^0x/i, "");
  const out: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const n = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out.length ? out : [4919];
}

/// One closed hypotrochoid: a circle of radius `r` rolling inside one of
/// radius `R`, with the pen offset by `d`.
function ringPath(
  c: number,
  R: number,
  k: number,
  dRatio: number,
  phase: number,
  samples: number
): string {
  const r = R / k;
  const d = r * dRatio;
  const a = R - r;
  let s = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2 + phase;
    const x = c + a * Math.cos(t) + d * Math.cos((k - 1) * t);
    const y = c + a * Math.sin(t) - d * Math.sin((k - 1) * t);
    s += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${s}Z`;
}

export function Rosette({
  seed,
  size = 40,
  rings,
  spin = false,
  className = "text-slate",
}: {
  /// A ciphertext handle, or any on-chain value worth drawing (a round's
  /// randomness, an epoch number). Undefined draws a stable placeholder.
  seed?: string | bigint | null;
  size?: number;
  /// Left unset, ring count follows size — three rings at 30px is mud, and one
  /// ring at 116px is a doodle.
  rings?: number;
  /// Turns only while real work is in flight. Motion here means "your key is
  /// being used right now", never ambience.
  spin?: boolean;
  className?: string;
}) {
  const raw =
    typeof seed === "bigint"
      ? seed.toString(16).padStart(64, "0")
      : (seed ?? "0x00c0ffee");

  const ringCount = rings ?? (size < 40 ? 2 : size < 90 ? 3 : 4);
  // Absolute in viewBox units, which equal px here — so the line stays hairline
  // at every scale rather than thickening with the figure.
  const stroke = Math.max(0.5, size / 150);

  const groups = useMemo(() => {
    const S = seeds(raw);
    const c = size / 2;
    return Array.from({ length: ringCount }, (_, i) => {
      const k = 5 + (S[(i * 3) % S.length] % 12);
      const dRatio = 0.55 + (S[(i * 3 + 1) % S.length] % 90) / 100;
      const phase = ((S[(i * 3 + 2) % S.length] % 360) * Math.PI) / 180;
      const R = size * (0.44 - i * (0.3 / ringCount));
      // Each ring is drawn twice, a hair apart — the doubled line is what makes
      // engraved line work read as engraved rather than as a wireframe.
      return [0, 1].map((j) => ({
        d: ringPath(c, R - j * (size * 0.014), k, dRatio, phase + j * 0.07, 320),
        opacity: 0.5 - j * 0.16,
      }));
    });
  }, [raw, size, ringCount]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", overflow: "visible" }}
    >
      {groups.map((paths, i) => (
        <g
          key={i}
          style={
            spin
              ? {
                  transformOrigin: "50% 50%",
                  animation: `p2s-turn ${22 + i * 8}s linear infinite`,
                }
              : undefined
          }
        >
          {paths.map((p, j) => (
            <path
              key={j}
              d={p.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              opacity={p.opacity}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
