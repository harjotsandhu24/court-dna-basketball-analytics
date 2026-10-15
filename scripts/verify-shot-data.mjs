// Pre-deploy check: the shot-location files (shipped in a separate ZIP) are all present and well-formed.
// Usage: npm run verify:data   (exit code 1 on any problem)
import { readFileSync, readdirSync, existsSync } from "node:fs";

const root = "public/data/shots";
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
if (!existsSync(`${root}/manifest.json`)) {
  fail(`${root}/manifest.json is missing. Extract the shot-data ZIP into this folder (see docs/deployment.md).`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
let files = 0, shots = 0, bad = 0;
for (const [season, e] of Object.entries(manifest.seasons)) {
  if (e.status !== "integrated") continue;
  const dir = `${root}/${season}`;
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
  if (names.length !== e.files) fail(`${season}: ${names.length} files on disk, manifest says ${e.files}`);
  for (const n of names) {
    const f = JSON.parse(readFileSync(`${dir}/${n}`, "utf8"));
    if (f.v !== 2 || f.season !== Number(season) || `${f.player_id}.json` !== n || f.s.length !== 5 * f.attempts) { bad++; if (bad < 5) fail(`${dir}/${n} is malformed`); }
    files++; shots += f.attempts;
  }
}
const summary = JSON.parse(readFileSync("public/data/shot_baselines.json", "utf8"));
const withShots = Object.values(summary.seasons).filter((s) => s.shots).length;
if (withShots !== Object.values(manifest.seasons).filter((e) => e.status === "integrated").length) fail("shot_baselines.json and the manifest disagree on the number of seasons");
console.log(`${files} player-season files, ${shots.toLocaleString("en-US")} shots, ${withShots} seasons with baselines`);
if (!process.exitCode) console.log("Shot data OK");
