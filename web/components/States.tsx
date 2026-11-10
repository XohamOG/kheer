import Link from "next/link";

/** Always mounted, so screen readers announce the message when it appears. */
export function Notice({ message, center }: { message: string | null; center?: boolean }) {
  return (
    <p className="error" role="alert" style={center ? { textAlign: "center" } : undefined}>
      {message ?? ""}
    </p>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return (
    <div className="gate stage" role="status">
      <p>{error ?? "Loading…"}</p>
    </div>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <div className="gate stage">
      <h1 className="title">No {what} with this number.</h1>
      <p>It may not exist yet on this registry.</p>
      <Link className="btn quiet" href="/">Browse agents</Link>
    </div>
  );
}
