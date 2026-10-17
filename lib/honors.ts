/**
 * Season honors: descriptive metadata only. This module is never imported by similarity, lineup scoring or
 * simulation code (a test checks that), so honors cannot change any number in the app.
 *
 * Season = the year the season ends (2005 = 2004-05). An award announced in spring 2005 belongs to 2004-05.
 * Winners only: voting placements are not stored, so a runner-up can never show as a winner.
 */
export type HonorKey =
  | "mvp" | "dpoy" | "roy" | "smoy" | "mip" | "allnba" | "alldef" | "allrookie" | "allstar" | "finalsmvp" | "champion" | "ring";

export interface HonorItem { k: HonorKey; t?: number; s?: true; r?: true; tm?: string }
export interface Coverage {
  from: number; to: number; introduced: number; noGame?: number[]; basis?: string; seasons?: number[];
  /** one letter per season from 1996-97: V verified by two or more sources, S one source, D derived from game results, P partial, - missing */
  status?: string;
}
export interface HonorsFile {
  dataVersion: string;
  note: string;
  coverage: Record<string, Coverage | null>;
  players: Record<string, Record<string, HonorItem[]>>;
}

const ORDER: HonorKey[] = ["ring", "champion", "finalsmvp", "mvp", "dpoy", "roy", "smoy", "mip", "allnba", "alldef", "allrookie", "allstar"];
const TEAM = ["", "First Team", "Second Team", "Third Team"];

export const HONOR_NAMES: Record<HonorKey, string> = {
  mvp: "Most Valuable Player", dpoy: "Defensive Player of the Year", roy: "Rookie of the Year",
  smoy: "Sixth Man of the Year", mip: "Most Improved Player", allnba: "All-NBA", alldef: "All-Defensive",
  allrookie: "All-Rookie", allstar: "All-Star", finalsmvp: "Finals MVP", champion: "Played in the playoffs for the champion", ring: "On the championship roster",
};

export interface HonorView { key: string; label: string; detail?: string }

export type HonorsState =
  | { state: "honors"; items: HonorView[]; partialNote: string | null }
  | { state: "none"; message: string }
  | { state: "partial"; items: HonorView[]; message: string }
  | { state: "unavailable"; message: string };

/**
 * Three different facts are kept apart:
 *  - the team won the title (cross-checked against independent sources);
 *  - the player appeared in a playoff game for that team ("champion" here: derived from game results);
 *  - the player is listed as a member of the championship roster ("ring": only where a source lists him, such as the Finals MVP lists).
 * A regular-season team or a playoff appearance never creates a roster claim, and full ring lists aren't available.
 */
export const CHAMPION_NOTE = "\u201cPlayed in the playoffs for the champion\u201d means the player appeared in a playoff game for the title team. It doesn't say he received a ring, and players who never appeared aren't listed. \u201cOn the championship roster\u201d appears only where a source lists him.";
export const POSTSEASON_NOTE = "Honors are descriptive only and never change any score or simulation.";
const LABELS: Record<string, string> = {
  mvp: "MVP", dpoy: "Defensive Player", roy: "Rookie of the Year", smoy: "Sixth Man", mip: "Most Improved", allnba: "All-NBA", alldef: "All-Defensive",
  allrookie: "All-Rookie", allstar: "All-Star", finalsmvp: "Finals MVP", champion: "champion",
};

/** A short, honest line about how this season's honors were checked. Null when there is nothing to say. */
export function sourceNote(file: HonorsFile, season: number): string | null {
  const two: string[] = [], one: string[] = [];
  for (const [k, c] of Object.entries(file.coverage)) {
    if (!c || !c.status || !LABELS[k]) continue;
    const ch = c.status[season - 1997];
    if (ch === "V") two.push(LABELS[k]);
    else if (ch === "S") one.push(LABELS[k]);
  }
  if (!two.length && !one.length) return null;
  const parts: string[] = [];
  if (two.length) parts.push(`checked against two sources: ${two.join(", ")}`);
  if (one.length) parts.push(`from one source: ${one.join(", ")}`);
  return `Honors data for this season: ${parts.join("; ")}.`;
}

export function seasonLabel(s: number): string {
  return `${s - 1}-${String(s).slice(-2)}`;
}

function view(it: HonorItem): HonorView {
  const name = HONOR_NAMES[it.k];
  if (it.k === "allnba" || it.k === "alldef" || it.k === "allrookie") return { key: `${it.k}${it.t}`, label: `${name} ${TEAM[it.t ?? 0]}` };
  if (it.k === "roy" && it.s) return { key: it.k, label: name, detail: "Shared award" };
  if (it.k === "champion" || it.k === "ring") return { key: it.k, label: name, detail: it.tm ? `with ${it.tm}` : undefined };
  if (it.k === "allstar") return { key: it.k, label: name, detail: it.r ? "Added as a replacement" : undefined };
  return { key: it.k, label: name };
}

/** Which of the nine categories have data for this season? */
export function coveredCategories(file: HonorsFile, season: number): { covered: HonorKey[]; missing: HonorKey[]; notYet: HonorKey[] } {
  const covered: HonorKey[] = [], missing: HonorKey[] = [], notYet: HonorKey[] = [];
  for (const k of ORDER) {
    if (k === "ring") continue; // roster membership is partial by nature; it never makes a season "incomplete"
    const c = file.coverage[k];
    if (!c || season > c.to) missing.push(k);
    else if (season < c.introduced) notYet.push(k); // the award didn't exist yet: not a gap
    else covered.push(k);
  }
  return { covered, missing, notYet };
}

export function honorsFor(file: HonorsFile | null, playerId: string, season: number): HonorsState {
  if (!file) return { state: "unavailable", message: "Honors couldn't be loaded right now." };
  const raw = file.players[playerId]?.[String(season)] ?? [];
  const hasRing = raw.some((i) => i.k === "ring");
  const items = raw
    .filter((i) => !(i.k === "champion" && hasRing)) // the roster fact already says it
    .slice()
    .sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k) || (a.t ?? 0) - (b.t ?? 0))
    .map(view);
  const { missing: allMissing } = coveredCategories(file, season);
  const isChamp = raw.some((i) => i.k === "champion" || i.k === "ring");
  // Finals MVP can only be won by a member of the title team. Where champion data exists, a player who isn't on it
  // is ruled out by the data; for a champion player, a missing Finals MVP list means we can't say.
  const champCovered = !!file.coverage.champion && season <= file.coverage.champion.to && season >= file.coverage.champion.introduced;
  const missing = allMissing.filter((k) => !(k === "finalsmvp" && champCovered && !isChamp));
  // Champion-roster gaps never make a non-champion's honors "incomplete" when champion data is covered.
  if (missing.length === 0) {
    return items.length ? { state: "honors", items, partialNote: null } : { state: "none", message: "No recorded honors" };
  }
  const names = missing.map((k) => HONOR_NAMES[k]);
  const note = `Honors for ${seasonLabel(season)} are incomplete: ${missing.length >= ORDER.length - 1 ? "no award data" : "no data for " + names.join(", ")} yet.`;
  if (items.length) return { state: "honors", items, partialNote: note };
  return { state: "partial", items: [], message: note };
}

let pending: Promise<HonorsFile> | null = null;
export function loadHonors(): Promise<HonorsFile> {
  if (!pending) {
    pending = fetch("/data/honors.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load /data/honors.json: ${r.status}`);
        return r.json() as Promise<HonorsFile>;
      })
      .catch((e) => {
        pending = null; // next call retries
        throw e;
      });
  }
  return pending;
}
