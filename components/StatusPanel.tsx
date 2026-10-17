import type { ReactNode } from "react";

/**
 * One consistent panel for every non-happy path: an invalid link, a record that doesn't exist, a connection problem.
 * A connection problem gets an inline Retry; the others get a way back instead. `inline` is the compact form used
 * for an optional section that failed while the rest of the page keeps working.
 */
export default function StatusPanel({
  tone,
  title,
  message,
  onRetry,
  actions,
  inline = false,
  testId,
}: {
  tone: "invalid" | "notfound" | "error";
  title: string;
  message?: string;
  onRetry?: () => void;
  actions?: ReactNode;
  inline?: boolean;
  testId?: string;
}) {
  const retry = onRetry ? (
    <button type="button" onClick={onRetry} className="btn btn-primary min-h-11 px-4 py-2 text-sm">
      Retry
    </button>
  ) : null;
  if (inline) {
    return (
      <div role={tone === "error" ? "alert" : "status"} data-testid={testId} data-state={tone} className="flex flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-arena-panel px-4 py-3 text-sm text-stone">
        <span className="min-w-0 flex-1">
          <strong className="font-semibold text-ink-light">{title}</strong>
          {message ? <> {message}</> : null}
        </span>
        {retry}
        {actions}
      </div>
    );
  }
  return (
    <div role={tone === "error" ? "alert" : "status"} data-testid={testId} data-state={tone} className="mx-auto max-w-xl px-5 py-20 text-center md:px-8">
      <h1 className="font-display text-3xl text-ink">{title}</h1>
      {message && <p className="mt-2 text-stone">{message}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {retry}
        {actions}
      </div>
    </div>
  );
}
