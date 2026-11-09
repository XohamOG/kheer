import type { Review } from "@/lib/near";

export function ReviewCard({ title, review }: { title: string; review: Review }) {
  return (
    <div className="answer">
      <h3>{title}</h3>
      <div className="score">
        {review.score ?? "–"}
        <small> / 10</small>
      </div>
      <p>{review.verdict}</p>
      {review.stub && <p className="chip" style={{ marginTop: 10 }}>Test stub. No AI ran.</p>}
      {review.flags.map((f) => (
        <p key={f} className="chip" style={{ marginTop: 10 }}>{f}</p>
      ))}
      {review.fixes.length > 0 && (
        <ul>
          {review.fixes.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
