import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function Badge(
  { tone = "", children, title }: { tone?: string; children: ReactNode; title?: string },
) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Notice(
  { tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode },
) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function Field(
  { label, hint, children }: { label: string; hint?: string; children: ReactNode },
) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Bar({ value }: { value: number }) {
  return <div className="bar"><i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>;
}

/** Small vertical bar chart used for score distributions. */
export function Distribution({ buckets }: { buckets: { bucket: string; count: number }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="dist">
      {buckets.map((b) => (
        <div className="dist-col" key={b.bucket} title={`${b.bucket}: ${b.count}`}>
          <i style={{ height: `${(b.count / max) * 32 + 2}px` }} />
          <span>{b.bucket}</span>
        </div>
      ))}
    </div>
  );
}

/** Data loading with the states the UI actually needs: loading, error, reload. */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null; loading: boolean; reload: () => void; setData: (v: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loader()
      .then((value) => { if (alive.current) setData(value); })
      .catch((e: unknown) => { if (alive.current) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive.current) setLoading(false); });
    // The loader closes over `deps`; re-running on `nonce` is the explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []), setData };
}

/** A button that runs an async action and reports its own progress and failure. */
export function ActionButton(
  {
    onRun, children, className = "btn primary", disabled, busyLabel, confirm,
  }: {
    onRun: () => Promise<unknown>;
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    busyLabel?: string;
    confirm?: string;
  },
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        className={className}
        disabled={disabled || busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError(null);
          try {
            await onRun();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <><Spinner />{busyLabel ?? "Working…"}</> : children}
      </button>
      {error ? <span className="badge red" title={error}><i className="dot" />{truncate(error, 70)}</span> : null}
    </>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
