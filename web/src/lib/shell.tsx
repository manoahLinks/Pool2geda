import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { describeError, type ErrorNote } from "@/lib/errors";

/// App-level UI state: the one notice bar, the one waiting overlay, the one
/// result dialog.
///
/// These are singular on purpose. The old layout scattered a busy flag and an
/// error line into every panel, which meant a 12-second proof looked like a
/// dead button in the corner of a page that was otherwise idle. Hoisting them
/// makes the app say exactly one thing at a time about what it is doing.

/// What we are waiting on. The distinction matters to the user: `proof` runs on
/// their own machine before the wallet ever opens, which is why it needs the
/// most explanation.
export type BusyKind = "proof" | "tx" | "settle";

type Busy = { kind: BusyKind; startedAt: number };
export type Notice = ErrorNote & { tone: "good" | "bad" };
export type Result = { won: boolean; amount: bigint; round: string };

type Shell = {
  busy: Busy | null;
  notice: Notice | null;
  result: Result | null;
  notify: (n: Notice) => void;
  dismissNotice: () => void;
  showResult: (r: Result) => void;
  closeResult: () => void;
  /// Run an async step behind the waiting overlay. Failures surface in the
  /// notice bar in the user's language, so no call site handles errors itself.
  /// Resolves to undefined if the step failed.
  run: <T>(kind: BusyKind, fn: () => Promise<T>) => Promise<T | undefined>;
};

const Ctx = createContext<Shell | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const notify = useCallback((n: Notice) => setNotice(n), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const showResult = useCallback((r: Result) => setResult(r), []);
  const closeResult = useCallback(() => setResult(null), []);

  const run = useCallback(
    async <T,>(kind: BusyKind, fn: () => Promise<T>): Promise<T | undefined> => {
      setNotice(null);
      setBusy({ kind, startedAt: Date.now() });
      try {
        return await fn();
      } catch (e) {
        setNotice({ tone: "bad", ...describeError(e) });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const value = useMemo(
    () => ({ busy, notice, result, notify, dismissNotice, showResult, closeResult, run }),
    [busy, notice, result, notify, dismissNotice, showResult, closeResult, run]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): Shell {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell must be used inside <ShellProvider>");
  return v;
}
