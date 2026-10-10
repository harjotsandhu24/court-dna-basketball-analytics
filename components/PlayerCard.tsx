import Link from "next/link";
import PlayerPhoto from "./PlayerPhoto";
import CourtPrint from "./CourtPrint";
import type { PlayerSeasonRecord } from "@/lib/types";
import { fmt1 } from "@/lib/format";

interface PlayerCardProps {
  record: PlayerSeasonRecord;
  similarity?: number;
  reasons?: string[];
  showCourtPrint?: boolean;
}

export default function PlayerCard({ record, similarity, reasons, showCourtPrint = true }: PlayerCardProps) {
  return (
    <Link
      href={`/player/${record.player_id}/${record.season}`}
      className="card-interactive group flex flex-col gap-3 rounded-xl bg-arena-panel p-4"
    >
      <div className="flex items-center gap-3">
        <PlayerPhoto playerId={record.player_id} name={record.player} posGroup={record.pos_group} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink-light group-hover:text-court-orange-bright transition-colors">
            {record.player}
          </p>
          <p className="text-xs text-stone">
            {record.season_label} · {record.team} · {record.pos}
          </p>
        </div>
        {similarity != null && (
          <div className="text-right shrink-0">
            <div className="font-display text-2xl leading-none text-court-orange-bright tabular">
              {Math.round(similarity)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-stone-light">Style Match</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {showCourtPrint && (
          <CourtPrint traits={record.traits} posGroup={record.pos_group} archetype={record.archetype} size={80} animate={false} />
        )}
        <div className="flex-1 text-xs">
          <p className="mb-1 inline-block rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-medium text-ink-light">
            {record.archetype}
          </p>
        </div>
      </div>

      {/* Full card width, not squeezed into the sliver beside the Court
          Print -- at the card's narrowest real-world width that sliver is
          only ~60px total for all three stats, not enough for "28.4" etc.
          to render without overflowing into the next column. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-stone-light">PTS</p>
          <p className="tabular text-xs font-semibold text-ink-light">{fmt1(record.basic.pts)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-stone-light">REB</p>
          <p className="tabular text-xs font-semibold text-ink-light">{fmt1(record.basic.trb)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-stone-light">AST</p>
          <p className="tabular text-xs font-semibold text-ink-light">{fmt1(record.basic.ast)}</p>
        </div>
      </div>

      {reasons && reasons.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-line pt-2 text-[11px] text-stone">
          {reasons.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      )}
    </Link>
  );
}
