export const LIMITATIONS_TEXT =
  "These comparisons use recorded statistics. They miss off-ball impact and much of defense. A high Similarity Index means the measured profiles are close; it does not establish equal ability or identical playing styles.";

/** Visible one-paragraph limitation + expandable detail on sources and coverage. */
export default function LimitationsNote({ className = "" }: { className?: string }) {
  return (
    <div className={`text-xs text-stone-light ${className}`}>
      <p>{LIMITATIONS_TEXT}</p>
      <details className="mt-2 rounded-md border border-line bg-arena-panel/40 p-3">
        <summary className="cursor-pointer text-ink-light focus-visible:outline-2 focus-visible:outline-court-orange-bright">
          What data is used, and what is missing?
        </summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
          <li>
            <strong className="text-ink-light">Source and coverage:</strong> Basketball-Reference season statistics
            (via a public Kaggle dataset), regular season only, 1996&ndash;97 to the present. The 12 similarity features are
            the same for every player-season in that range.
          </li>
          <li>
            <strong className="text-ink-light">Shooting Profile:</strong> shows distance zones (0&ndash;3, 3&ndash;10, 10&ndash;16, 16 ft&ndash;3PT,
            3PT, and deep threes of 30+ ft where locations exist). Real shot locations (regular season) exist for every season from 1996&ndash;97 on; any season without them shows distance zones with estimated makes and attempts.
          </li>
          <li>
            <strong className="text-ink-light">Not measured:</strong> screening, spacing gravity, communication, off-ball movement, and most
            defense. Steals, blocks and rebounds capture only part of defensive activity.
          </li>
          <li>
            <strong className="text-ink-light">Not included:</strong> playoff shot locations, hustle statistics, play types and
            defensive tracking. These were not integrated in this version, so they do not affect any score and there is no
            &ldquo;detailed comparison&rdquo; mode.
          </li>
          <li>Statistical closeness is not causation and does not show that two players have equal ability or play alike.</li>
        </ul>
      </details>
    </div>
  );
}
