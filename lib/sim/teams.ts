import { evaluateLineup, makePlayer, STARTERS } from "./strength";
import type { LineupEval } from "./strength";
import type { FeatureShard, ModelFile, SimPlayer, TeamEntry } from "./types";

/** How a real team is represented: its top five by minutes + the average bench ("equal"), or its actual rotation ("real"). */
export type Footing = "equal" | "real";

export function teamPlayers(team: TeamEntry, shard: FeatureShard, model: ModelFile): SimPlayer[] {
  const index = new Map(shard.ids.map((id, i) => [id, i] as const));
  const out: SimPlayer[] = [];
  for (const [id, mp] of team.players) {
    const i = index.get(id);
    if (i === undefined) continue; // the exporter only lists covered players, so this is defensive
    const p = makePlayer(shard, i, model);
    out.push({ ...p, mp }); // bench weights use minutes with THIS team, not the season total
  }
  return out;
}

export function evaluateTeam(team: TeamEntry, shard: FeatureShard, model: ModelFile, footing: Footing): LineupEval | null {
  if (!team.ok) return null;
  const players = teamPlayers(team, shard, model);
  if (players.length < STARTERS + 1) return null;
  const starters = players.slice(0, STARTERS);
  const bench = players.slice(STARTERS);
  return evaluateLineup(starters, footing === "real" ? bench : null, model);
}
