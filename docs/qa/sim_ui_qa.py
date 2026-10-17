"""Browser QA for Simulate (three modes, number-first results), season honors and navigation. Chromium only (Playwright).
Needs `npm run build && npx next start -p 3100` and `pip install playwright`.
Usage: QA_BASE=http://localhost:3100 python3 docs/qa/sim_ui_qa.py
Writes screenshots to docs/screenshots/phase11/. Exit code 1 if any check fails.
Waits are for real state (content, jobs, network quiet); there are no fixed sleeps. See qa_common.py."""
import asyncio, json, re, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from qa_common import B, SHOTS, ok, finish, settle, Errors, new_context, delay, no_hscroll

# FIVE: five all-stars from five teams (far from any real starting five: the support check calls this unsupported)
FIVE = [("nashst01", 2005), ("duncati01", 2005), ("nowitdi01", 2005), ("garneke01", 2005), ("onealsh01", 2005)]
# REAL: the 2004-05 Phoenix starting five (a lineup the support check accepts)
REAL = [("nashst01", 2005), ("johnsjo02", 2005), ("mariosh01", 2005), ("richaqu01", 2005), ("stoudam01", 2005)]
def saved(five): return json.dumps({"v": 1, "slots": [{"id": i, "season": s} for i, s in five]})

ROUGH = "*Rough simulation—not a reliable prediction."
UNLIKE = "This lineup is unlike the teams used to test the model."
CONTRIB = re.compile(r"[+−]\d+\.\d")  # a "+8.5" style contribution number

async def new_page(ctx, errs, lineup=REAL, settings=None, routes=(), v1=None):
    pg = await ctx.new_page()
    init = "try{if(!sessionStorage.getItem('qa_init')){localStorage.clear();"
    if lineup: init += f"localStorage.setItem('courtdna.lineup.v1',{json.dumps(saved(lineup))});"
    if settings is not None: init += f"localStorage.setItem('courtdna.sim.settings.v2',{json.dumps(settings)});"
    if v1 is not None: init += f"localStorage.setItem('courtdna.sim.settings.v1',{json.dumps(v1)});"
    init += "sessionStorage.setItem('qa_init','1')}}catch(e){}"
    await pg.add_init_script(init)
    # Wikimedia is external: photos are blocked on purpose (initials fallback) and the block is classified, not hidden.
    await pg.route("**/upload.wikimedia.org/**", lambda r: r.abort())
    for pat, h in routes: await pg.route(pat, h)
    errs.attach(pg)
    return pg

async def goto(pg, ready=True, five=True):
    await pg.goto(B + "/build-a-five")
    await pg.wait_for_selector('[data-testid="sim-panel"]')
    if ready: await pg.wait_for_selector('button[data-slot="PG"]:has-text("Nash")', timeout=15000)
    if ready and five: await pg.wait_for_selector('[data-testid="sim-lineup-summary"]', timeout=15000)
    await settle(pg)

def panel(pg): return pg.locator('[data-testid="sim-panel"]')
def sim_btn(pg): return panel(pg).get_by_role("button", name=re.compile(r"^(Simulate|Simulating)"))
def sel(pg, text): return panel(pg).locator(f"xpath=.//label[starts-with(normalize-space(.), '{text}')]//select").first
def results(pg): return pg.locator('[data-testid="sim-results"]')
def how(pg): return results(pg).locator('[data-testid="how-it-works"]')
async def choose(pg, label): await panel(pg).get_by_role("radio", name=re.compile(label)).check()
async def run(pg, timeout=60000):
    await sim_btn(pg).click()
    await results(pg).wait_for(timeout=timeout)
async def options_loaded(pg, n=10):
    await pg.wait_for_function(f"[...document.querySelectorAll('[data-testid=sim-panel] select')].some(s=>s.options.length>{n})", timeout=15000)
async def vis(pg): return await results(pg).inner_text()
async def full(pg): return await results(pg).text_content() or ""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await new_context(b, viewport={"width": 1300, "height": 900})
        E = Errors()

        # ---------- fewer than five players: one short line, no controls ----------
        pg = await new_page(ctx, E, lineup=REAL[:3])
        await goto(pg, ready=False)
        ok("top-level navigation still has four links", await pg.locator('nav[aria-label="Primary"] a').count() == 4)
        ok("under five players the panel says only 'Add five players to simulate your lineup.'",
           (await panel(pg).locator('[data-testid="sim-need-five"]').inner_text()).strip() == "Add five players to simulate your lineup.")
        ok("no mode choices, settings or Simulate button until five players are chosen",
           await panel(pg).get_by_role("radio").count() == 0 and await sim_btn(pg).count() == 0 and await panel(pg).locator("details").count() == 0)
        await pg.close()
        pg = await new_page(ctx, E, lineup=None)
        await goto(pg, ready=False)
        ok("an empty lineup shows the same single instruction", await panel(pg).locator('[data-testid="sim-need-five"]').count() == 1 and await panel(pg).get_by_role("radio").count() == 0)
        await pg.close()

        # ---------- 82-game season (a real starting five: supported) ----------
        pg = await new_page(ctx, E)
        await goto(pg)
        ok("controls appear once five players are chosen: three simple modes with the new wording",
           await panel(pg).get_by_role("radio").count() == 5
           and all([await panel(pg).get_by_text(t, exact=True).count() >= 1 for t in ("82-game season", "Seven-game series", "Playoff bracket", "Estimate season wins.", "Play another lineup or team.", "Enter a historical playoff bracket.")]))
        ok("a compact summary names the five players and seasons near the simulator",
           await panel(pg).locator('[data-testid="sim-lineup-summary"] li').count() == 5 and "Steve Nash · 2004-05" in await panel(pg).locator('[data-testid="sim-lineup-summary"]').inner_text())
        ok("advanced settings stay collapsed", not await panel(pg).locator("details").first.evaluate("e=>e.open"))
        ok("Simulate enabled with five unique players", await sim_btn(pg).is_enabled())
        ok("the panel says this is not a preseason forecast and stays short", "Not a preseason forecast" in await panel(pg).inner_text())
        await run(pg)
        v, t = await vis(pg), await full(pg)
        m = re.search(r"Estimated record\s*\n?\s*(\d+)–(\d+)", v, re.I)
        rng = re.search(r"Likely range:\s*(\d+)[–-](\d+)\s*wins", v)
        ok("the headline is an estimated record (whole numbers 0-82 that total 82) with a likely range labelled in wins", m and int(m.group(1)) + int(m.group(2)) == 82 and rng and 0 <= int(rng.group(1)) <= int(rng.group(2)) <= 82, v[:400])
        spoken = (await results(pg).locator('[data-testid="sim-record-spoken"]').text_content() or "").strip()
        ok("screen readers hear 'N wins, M losses' for the record (the visual dash text is hidden from them)", m and spoken == f"{m.group(1)} wins, {m.group(2)} losses" and await results(pg).locator('[data-testid="sim-record"]').get_attribute("aria-hidden") == "true", spoken)
        ok("the old 'of 82' and 'Estimated wins' wording is gone", "of 82" not in v and "Estimated wins" not in v)
        ok("a small Experimental label is shown", "EXPERIMENTAL" in v.upper() and await results(pg).locator("text=Experimental").count() >= 1)
        ok("uncertain headline carries an asterisk", await results(pg).locator('[data-testid="headline-asterisk"]').count() == 1)
        note = results(pg).locator('[data-testid="uncertainty-note"]')
        ok("the asterisk explanation is visible without hovering and reads exactly '*Rough simulation—not a reliable prediction.'", await note.is_visible() and ROUGH in await note.inner_text(), await note.inner_text())
        hl = results(pg).locator('[data-testid="sim-headline"] p.font-display')
        nid = await note.get_attribute("id")
        ok("the explanation is attached to its number for screen readers (aria-describedby) and sits directly below it",
           (await hl.get_attribute("aria-describedby")) == nid
           and (await hl.bounding_box())["y"] < (await note.bounding_box())["y"] < (await hl.bounding_box())["y"] + (await hl.bounding_box())["height"] + 60)
        ok("a supported lineup does not claim to be unlike the tested teams", UNLIKE not in v)
        ok("no 'Show the numbers anyway' button exists", await pg.get_by_role("button", name=re.compile("Show the numbers", re.I)).count() == 0)
        n_str = await results(pg).locator('[data-testid="takeaways"] h3:has-text("Strengths") + ul > li').count()
        n_con = await results(pg).locator('[data-testid="takeaways"] h3:text-matches("Things to watch|Relative weaknesses") + ul > li, [data-testid="takeaways"] h3:text-matches("Things to watch|Relative weaknesses") + p + ul > li').count()
        ok("at most three strengths and two concerns, nothing forced", n_str <= 3 and n_con <= 2, (n_str, n_con))
        ok("concern heading is 'Things to watch' or 'Relative weaknesses' (never 'Below-average' wording)", "below-average" not in v.lower() and ("things to watch" in v.lower() or "relative weaknesses" in v.lower() or n_con == 0))
        ok("contribution numbers like +8.5 are hidden by default", not CONTRIB.search(v), CONTRIB.findall(v)[:3])
        ok("compact assumption labels stay visible", all(c in v for c in ("Average bench", "Healthy players", "2004-05 league")))
        ok("exactly one collapsed 'How it works' section with a Methodology link", await how(pg).count() == 1 and not await how(pg).evaluate("e=>e.open") and await how(pg).locator('a[href="/methodology"]').count() == 1 and await results(pg).locator("details").count() == 1)
        ok("model stats, exact contributions, usage, assumptions, testing and versions are inside it",
           all(x in t for x in ("Model statistics", "Contribution of each area", "Sharing one ball", "Assumptions", "How well has this been tested?", "Support check", "Seed ")) and CONTRIB.search(t) is not None)
        ok("dimension names are the short ones; defense is described by its inputs, never as a complete 'Defense' rating",
           "Playmaking" in t and "Ball security & rebounding" in t and "Steals, blocks & defensive rebounds" in t
           and "Creation" not in t and "Possession control" not in t and "Defensive box-score signals" not in t)
        ok("no repeated warnings: the rough-simulation note appears once in the visible result", v.count("Rough simulation") == 1, v.count("Rough simulation"))
        ok("accuracy wording: RMSE and MAE separate, and the baseline that was not beaten is stated", "RMSE" in t and "mean absolute error" in t and "did not beat last season" in t and "9.98" in t and "9.84" in t and "average error" not in t)
        ok("schedule is described as hypothetical (inside the details)", "balanced hypothetical schedule" in t)
        ok("focus moves to the results", await pg.evaluate("document.activeElement && document.activeElement.getAttribute('data-testid')") == "sim-results")
        await pg.screenshot(path=f"{SHOTS}/after-season-desktop.png", full_page=True)
        first = re.search(r"Seed (\d+)", t).group(1)
        await pg.reload(); await pg.wait_for_selector('[data-testid="sim-lineup-summary"]', timeout=15000); await run(pg)
        t2 = await full(pg)
        ok("same lineup and settings reproduce the same result", re.search(r"Seed (\d+)", t2).group(1) == first and t2 == t)
        await pg.locator('button[data-slot="C"]').click()
        await pg.get_by_role("button", name="Remove").click()
        await panel(pg).locator('[data-testid="sim-need-five"]').wait_for()
        ok("removing a player clears the results at once and the controls give way to the one-line instruction", await results(pg).count() == 0 and await sim_btn(pg).count() == 0)
        await pg.close()

        # ---------- season: replace a real team instead of adding one ----------
        pg = await new_page(ctx, E); await goto(pg)
        await panel(pg).get_by_role("radio", name=re.compile("Taking a real team")).check()
        ok("Simulate waits for the team to replace", await sim_btn(pg).is_disabled() and "replaces" in await panel(pg).inner_text())
        await options_loaded(pg)
        await sel(pg, "Team to replace").select_option(index=3)
        await run(pg)
        t = await full(pg)
        ok("replacing a team is stated, and the replaced team is not an opponent", "takes the place of" in t and "extra team added" not in t, t[-900:])
        await pg.close()

        # ---------- season: an unsupported lineup is shown number-first with the plain caveat, never a range ----------
        pg = await new_page(ctx, E, lineup=FIVE); await goto(pg)
        await run(pg)
        v, t = await vis(pg), await full(pg)
        m = re.search(r"Estimated record\s*\n?\s*(\d+)–(\d+)", v, re.I)
        ok("unsupported lineup: the computed record is shown by default (and totals 82)", m and int(m.group(1)) + int(m.group(2)) == 82, v[:300])
        ok("unsupported lineup: asterisk, the rough-simulation note and 'This lineup is unlike the teams used to test the model.'", ROUGH in v and UNLIKE in v and await results(pg).locator('[data-testid="headline-asterisk"]').count() == 1, v[:400])
        ok("unsupported lineup: the old 'too different' wording and the reveal button are gone", "too different from the teams" not in t and await pg.get_by_role("button", name=re.compile("Show the numbers", re.I)).count() == 0)
        ok("unsupported lineup: no prediction range anywhere", await results(pg).locator('[data-testid="sim-range"]').count() == 0 and "Likely range" not in t and "80% range if" not in t and "typical error" not in t, t[:300])
        ok("unsupported lineup: the support check still ran and is in the details", "Support check: Unsupported" in t and "Assumptions" in t)
        ok("unsupported lineup: strengths/concerns still limited", await results(pg).locator('[data-testid="takeaways"] h3:has-text("Strengths") + ul > li').count() <= 3)
        await pg.screenshot(path=f"{SHOTS}/after-season-unsupported-desktop.png", full_page=True)
        await pg.reload(); await pg.wait_for_selector('[data-testid="sim-lineup-summary"]', timeout=15000)
        await run(pg)
        ok("after a reload the same numbers appear again (nothing is hidden behind a per-visit reveal)", re.search(r"Estimated record\s*\n?\s*\d+–\d+", await vis(pg), re.I))
        await pg.close()

        # ---------- an unsupported lineup is number-first in series and bracket mode too ----------
        pg = await new_page(ctx, E, lineup=FIVE); await goto(pg)
        await choose(pg, "Seven-game series")
        await panel(pg).get_by_role("radio", name=re.compile("A real team")).check()
        await sel(pg, "Season").select_option("2005")
        await pg.wait_for_function("[...document.querySelectorAll('[data-testid=sim-panel] select')].some(s=>s.options.length>5 && /\\(/.test(s.options[0].text))", timeout=15000)
        await sel(pg, "Team").select_option(index=1)
        await run(pg)
        v, t = await vis(pg), await full(pg)
        ok("series (unsupported): chance to win is shown with the asterisk, note and unlike-tested line", re.search(r"Chance to win the series\s*\n?\s*\d+%", v, re.I) and ROUGH in v and UNLIKE in v, v[:300])
        ok("series (unsupported): no range", "Likely range" not in t and await results(pg).locator('[data-testid="sim-range"]').count() == 0, t[:200])
        await choose(pg, "Playoff bracket")
        await options_loaded(pg)
        await sel(pg, "Postseason").select_option("2005"); await sel(pg, "Team to replace").select_option(index=1)
        await run(pg)
        v, t = await vis(pg), await full(pg)
        ok("bracket (unsupported): title chance shown with the asterisk, note and unlike-tested line", re.search(r"Chance to win the title\s*\n?\s*\d+(\.\d+)?%", v, re.I) and ROUGH in v and UNLIKE in v, v[:300])
        await pg.screenshot(path=f"{SHOTS}/after-bracket-unsupported-desktop.png", full_page=True)
        await pg.close()

        # ---------- duplicate click, cancel, late response ----------
        slow = [("**/data/sim/features/*.json", delay(1500))]
        pg = await new_page(ctx, E, routes=slow); await goto(pg)
        await sim_btn(pg).click()
        ok("button is disabled while running and progress is shown", await sim_btn(pg).is_disabled() and await panel(pg).get_by_role("progressbar").count() == 1)
        await sim_btn(pg).click(force=True)  # repeated click must not start a second job
        await panel(pg).get_by_role("button", name="Cancel").click()
        await panel(pg).get_by_text("Cancelled. Nothing was changed.").wait_for()
        await settle(pg)
        ok("Cancel stops the job and no result appears afterwards", await results(pg).count() == 0)
        ok("Simulate works again after cancelling", await sim_btn(pg).is_enabled())
        await sim_btn(pg).click(); await results(pg).wait_for(timeout=30000)
        ok("a fresh run after cancel completes", await results(pg).count() == 1)
        await pg.close()

        pg = await new_page(ctx, E, routes=slow); await goto(pg)
        await sim_btn(pg).click()
        await pg.locator('button[data-slot="C"]').click(); await pg.get_by_role("button", name="Remove").click()
        await panel(pg).locator('[data-testid="sim-need-five"]').wait_for()
        await settle(pg)  # the slow data request finishes here; its answer must be ignored
        ok("a response arriving after the lineup changed is never shown", await results(pg).count() == 0)
        await pg.close()

        # ---------- seven-game series vs a real team ----------
        pg = await new_page(ctx, E); await goto(pg)
        await choose(pg, "Seven-game series")
        await panel(pg).get_by_role("radio", name=re.compile("A real team")).check()
        await sel(pg, "Season").select_option("2005")
        await pg.wait_for_function("document.querySelector('[data-testid=sim-panel] select:not([disabled])') && [...document.querySelectorAll('[data-testid=sim-panel] select')].some(s=>s.options.length>5 && /\\(/.test(s.options[0].text))", timeout=15000)
        await sel(pg, "Team").select_option(index=1)
        await panel(pg).get_by_role("radio", name="Neutral court").check()
        await run(pg)
        v, t = await vis(pg), await full(pg)
        pw = re.search(r"Chance to win the series\s*\n?\s*(\d+)%", v, re.I)
        ok("series: the chance to win is the headline number", pw and 0 <= int(pw.group(1)) <= 100, v[:200])
        ok("series: Experimental label, asterisk and the visible note", "EXPERIMENTAL" in v.upper() and ROUGH in v and await results(pg).locator('[data-testid="headline-asterisk"]').count() == 1)
        ok("series: compact assumption labels", all(c in v for c in ("Average bench", "Healthy players", "Neutral court")))
        ok("series: length table, examples and exact differences are in the single details section", await how(pg).count() == 1 and await how(pg).locator("table tbody tr").count() == 4 and "Example series" in t and "Three biggest differences" in t and not (await how(pg).evaluate("e=>e.open")))
        ok("series: hidden by default: no +x.x contributions, no length table", not CONTRIB.search(v) and "Games" not in v)
        ok("series: model uncertainty is separate from game luck (inside details)", "game luck only" in t and "That model error doesn" in t)
        await pg.screenshot(path=f"{SHOTS}/after-series-desktop.png", full_page=True)
        await pg.close()

        # ---------- seven-game series vs a custom five (original lineup kept) ----------
        pg = await new_page(ctx, E); await goto(pg)
        await choose(pg, "Seven-game series")
        ok("Simulate waits for a full opponent", await sim_btn(pg).is_disabled() and "Build the opponent" in await panel(pg).inner_text())
        box = panel(pg).locator("input[type=search]")
        ok("the opponent search has an explicit accessible name", (await box.get_attribute("aria-label")) == "Search for an opponent player")
        olist = panel(pg).get_by_role("list", name="Opponent lineup")
        for i, (q, n) in enumerate([("nash", "Steve Nash"), ("joe johnson", "Joe Johnson"), ("shawn marion", "Shawn Marion"), ("quentin richardson", "Quentin Richardson"), ("stoudemire", "Amar'e Stoudemire")]):
            await box.fill(q)
            await pg.get_by_role("option").filter(has_text=n).first.click()
            await olist.locator("li").nth(i).wait_for()
            await panel(pg).get_by_label(f"Season for {n}").select_option("2005")
        ok("the same players may be on both teams", await olist.locator("li").count() == 5)
        ok("original lineup untouched", await pg.locator('button[data-slot="PG"]:has-text("Nash")').count() == 1)
        await run(pg)
        pw = re.search(r"Chance to win the series\s*\n?\s*(\d+)%", await vis(pg), re.I)
        ok("identical five vs identical five is near 50% (home court to you)", pw and 45 <= int(pw.group(1)) <= 75, await vis(pg))
        await pg.close()

        # ---------- playoff bracket ----------
        pg = await new_page(ctx, E); await goto(pg)
        await choose(pg, "Playoff bracket")
        await options_loaded(pg)
        psel = sel(pg, "Postseason")
        opts = await psel.locator("option").all_inner_texts()
        ok("every postseason from 1996-97 to 2025-26 is offered and none is greyed out", len([o for o in opts if re.match(r"\d{4}-\d{2}", o)]) == 30 and "2025-26" in " ".join(opts) and "1996-97" in " ".join(opts) and await psel.locator("option[disabled]").count() == 0, opts[:4])
        ok("Simulate stays disabled until a postseason and team are chosen", await sim_btn(pg).is_disabled())
        await psel.select_option("2005")
        team = sel(pg, "Team to replace")
        await team.select_option(index=1)
        ok("replay choices are 'Replay full bracket' and 'Follow actual opponents' with their one-line descriptions",
           all([await panel(pg).get_by_text(x, exact=True).count() == 1 for x in ("Replay full bracket", "Simulate every round.", "Follow actual opponents", "Face the replaced team’s historical opponents.")]))
        await run(pg)
        v, t = await vis(pg), await full(pg)
        ch = re.search(r"Chance to win the title\s*\n?\s*(\d+(?:\.\d+)?)%", v, re.I)
        ok("full replay: the title chance is the headline number with the asterisk and note", ch and ROUGH in v and await results(pg).locator('[data-testid="headline-asterisk"]').count() == 1, v[:300])
        samp = results(pg).locator('[data-testid="bracket-sample"]')
        ok("a sample simulated bracket is shown round by round and labelled as one random run, not the probabilities",
           await samp.count() == 1 and "sample simulated bracket" in (await samp.inner_text()).lower() and "one simulated run" in (await samp.inner_text()).lower() and "not the most likely outcome" in (await samp.inner_text()).lower())
        ok("the sample has 15 series across four rounds and states how the replaced slot fared", await samp.locator("ol > li").count() == 15 and await samp.locator('[data-testid="sample-outcome"]').count() == 1 and "in this sample your lineup" in (await samp.inner_text()).lower())
        ok("the advancement probability table is inside details, not in the default view", await how(pg).locator("tbody tr").count() == 16 and not await how(pg).locator("table").is_visible())
        cells = [float(x.strip("%")) for x in await how(pg).locator("tbody tr td:nth-child(3)").evaluate_all("els=>els.map(e=>e.textContent)")]
        ok("champion probabilities add to about 100%", abs(sum(cells) - 100) < 1.5, sum(cells))
        await samp.get_by_label("Show round").select_option("4")
        ok("the round selector narrows the sample to one round (the Finals: one series)", await samp.locator("ol > li").count() == 1)
        await samp.get_by_label("Show round").select_option("all")
        await pg.screenshot(path=f"{SHOTS}/after-bracket-full-desktop.png", full_page=True)
        await panel(pg).get_by_role("radio", name=re.compile("Follow actual opponents")).check()
        ok("switching replay mode clears the old result", await results(pg).count() == 0)
        await run(pg)
        v, t = await vis(pg), await full(pg)
        ok("following actual opponents is distinct: no sample bracket, no title odds, a hypothetical of actual opponents", await results(pg).locator('[data-testid="bracket-sample"]').count() == 0 and "hypothetical" in v.lower() and "not a bracket simulation" in v.lower() and "title odds" in v.lower() and "chance to win the title" not in v.lower() and "chance to win every series" in v.lower(), v[:500])
        await pg.screenshot(path=f"{SHOTS}/after-bracket-path-desktop.png", full_page=True)
        await panel(pg).get_by_role("radio", name=re.compile("Replay full bracket")).check()
        await psel.select_option("2026"); await team.select_option(index=1); await run(pg)
        ok("2025-26 postseason runs with a 16-team table in the details", await how(pg).locator("tbody tr").count() == 16 and "2025-26 playoffs" in await vis(pg))
        await psel.select_option("2020"); await team.select_option(index=1); await run(pg)
        t = await full(pg)
        ok("2019-20 is described as played at one neutral site (details)", "one site" in t and "neutral court" in t.lower(), t[-700:])
        ok("home court and seeds are explained as different things", "better regular-season record hosts" in t or "one site" in t)
        await psel.select_option("2007"); await team.select_option(index=1); await run(pg)
        t = await full(pg)
        ok("published seeds are labelled Seed, not 'Reconstructed bracket position'", "Seed*" in t and "Reconstructed bracket position" not in t and "display only" in t.lower(), t[-900:])
        ok("the equal-record rule is stated as an assumption, not an official rule", "assumption" in t.lower() and "official" in t.lower(), t[-900:])
        await panel(pg).locator("summary").first.click()
        tie = sel(pg, "Home court when tied")
        topts = await tie.locator("option").all_inner_texts()
        ok("the tie setting is 'Home court when tied' with three options, each labelled as an assumption", len(topts) == 3 and all("(assumption)" in o for o in topts), topts)
        await tie.select_option(index=1)
        ok("changing the tie choice clears the old result so it can't be mistaken for the new one", await results(pg).count() == 0)
        await run(pg)
        t2 = await full(pg)
        ok("the result states which tie choice was used", "your lineup" in t2.lower() and "hosts" in t2.lower(), t2[-600:])
        await pg.close()

        # ---------- download failures: inline Retry without a page reload ----------
        failed = {"n": 0}
        async def fail_once(route):
            if failed["n"] == 0:
                failed["n"] += 1; await route.abort()
            else:
                await route.continue_()
        E2 = Errors(); E2.expect_injected(r"sim/brackets\.json|sim/teams/")
        pg = await new_page(ctx, E2, routes=[("**/data/sim/brackets.json", fail_once)]); await goto(pg)
        await choose(pg, "Playoff bracket")
        await panel(pg).locator('[data-testid="brackets-error"]').wait_for()
        ok("a failed playoff-data download shows a clear error with Retry (not a permanent 'Loading…')", await panel(pg).locator('[data-testid="brackets-error"]').get_by_role("button", name="Retry").count() == 1 and "Loading…" not in await sel(pg, "Postseason").inner_text())
        await panel(pg).locator('[data-testid="brackets-error"]').get_by_role("button", name="Retry").click()
        await options_loaded(pg)
        ok("Retry recovers without reloading the page", await panel(pg).locator('[data-testid="brackets-error"]').count() == 0 and await sel(pg, "Postseason").locator("option").count() > 10)
        await pg.close()
        failed["n"] = 0
        pg = await new_page(ctx, E2, routes=[("**/data/sim/teams/2005.json", fail_once)]); await goto(pg)
        await choose(pg, "Seven-game series")
        await panel(pg).get_by_role("radio", name=re.compile("A real team")).check()
        await sel(pg, "Season").select_option("2005")
        await panel(pg).locator('[data-testid="teams-error"]').wait_for()
        ok("a failed team-list download shows an error with Retry, and Simulate says why it can't run", await panel(pg).locator('[data-testid="teams-error"]').get_by_role("button", name="Retry").count() == 1 and await sim_btn(pg).is_disabled())
        await panel(pg).locator('[data-testid="teams-error"]').get_by_role("button", name="Retry").click()
        await pg.wait_for_function("[...document.querySelectorAll('[data-testid=sim-panel] select')].some(s=>s.options.length>5 && /\\(/.test(s.options[0].text))", timeout=15000)
        ok("Retry recovers the team list", await panel(pg).locator('[data-testid="teams-error"]').count() == 0 and await sim_btn(pg).is_enabled())
        await pg.close()
        ok("injected failures were seen and classified as injected, not as app errors", len(E2.injected) >= 1 and not E2.app, E2.summary())

        # ---------- corrupted saved settings, reduced motion, keyboard ----------
        pg = await new_page(ctx, E, settings='{"v":1,"mode":"nonsense","seed":-4}'); await goto(pg)
        ok("corrupted saved settings fall back to defaults with a notice", await panel(pg).get_by_role("radio", name=re.compile("82-game")).is_checked() and "reset to the defaults" in await panel(pg).inner_text())
        await pg.close()
        pg = await new_page(ctx, E, v1='{"v":1,"mode":"bracket","seed":12}'); await goto(pg)
        ok("version 1 saved settings are migrated, not dropped", await panel(pg).get_by_role("radio", name=re.compile("Playoff bracket")).is_checked() and "reset to the defaults" not in await panel(pg).inner_text())
        await pg.close()
        pg = await new_page(ctx, E, settings='{"v":2,"mode":"series","leagueMode":"sideways"}'); await goto(pg)
        ok("an invalid new-version field resets only that field", await panel(pg).get_by_role("radio", name=re.compile("Seven-game")).is_checked() and "reset to the defaults" in await panel(pg).inner_text())
        await pg.close()
        pg = await new_page(ctx, E, settings="{{{{"); await goto(pg)
        ok("unparseable saved settings do not break the page", await sim_btn(pg).is_enabled())
        await pg.close()

        rctx = await new_context(b, viewport={"width": 1300, "height": 900}, reduced_motion="reduce")
        pg = await new_page(rctx, E, routes=slow); await goto(pg)
        await sim_btn(pg).click()
        await panel(pg).get_by_role("progressbar").wait_for()
        dur = await panel(pg).get_by_role("progressbar").locator("div").evaluate("e=>getComputedStyle(e).transitionDuration")
        ok("progress bar does not animate under reduced motion", all(float(x.strip().rstrip("s")) <= 0.001 for x in dur.split(",")), dur)
        await pg.close(); await rctx.close()

        pg = await new_page(ctx, E); await goto(pg)
        await panel(pg).get_by_role("radio", name=re.compile("82-game")).focus()
        await pg.keyboard.press("ArrowDown")
        ok("arrow keys change the mode", await panel(pg).get_by_role("radio", name=re.compile("Seven-game")).is_checked())
        await panel(pg).get_by_role("radio", name=re.compile("82-game")).check()
        await sim_btn(pg).focus(); await pg.keyboard.press("Enter")
        await results(pg).wait_for(timeout=30000)
        ok("Simulate can be run from the keyboard", await results(pg).count() == 1)
        await how(pg).locator("summary").focus(); await pg.keyboard.press("Enter")
        ok("How it works opens with the keyboard", await how(pg).evaluate("e=>e.open"))
        await panel(pg).locator("summary").first.focus(); await pg.keyboard.press("Enter")
        ok("settings open with the keyboard and mention browser-only saving", await panel(pg).locator("details").first.evaluate("e=>e.open") and "this browser only" in await panel(pg).inner_text())
        await pg.close()

        # ---------- phone width ----------
        mctx = await new_context(b, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        pg = await new_page(mctx, E); await goto(pg)
        await panel(pg).scroll_into_view_if_needed()
        await sim_btn(pg).tap(); await results(pg).wait_for(timeout=30000)
        ok("no horizontal scroll at phone width (season)", await no_hscroll(pg))
        await settle(pg)  # results scroll into view smoothly; measure only once the page is still
        nt = results(pg).locator('[data-testid="uncertainty-note"]')
        hb = await results(pg).locator('[data-testid="sim-headline"] p.font-display').bounding_box(); nb = await nt.bounding_box()
        ok("the asterisk note stays directly under its number on a phone", await nt.is_visible() and 0 <= nb["y"] - (hb["y"] + hb["height"]) < 40 and nb["x"] >= 0 and nb["x"] + nb["width"] <= 390)
        await pg.screenshot(path=f"{SHOTS}/after-season-phone.png", full_page=True)
        await choose(pg, "Playoff bracket"); await options_loaded(pg)
        await sel(pg, "Postseason").select_option("2005"); await sel(pg, "Team to replace").select_option(index=2)
        await sim_btn(pg).tap(); await results(pg).wait_for(timeout=60000)
        ok("no horizontal scroll at phone width (bracket)", await no_hscroll(pg))
        samp = results(pg).locator('[data-testid="bracket-sample"]')
        ok("on a phone the rounds stack and a round selector is offered", await samp.get_by_label("Show round").count() == 1 and await samp.locator("ol > li").count() == 15)
        await settle(pg)
        tb = await samp.locator("ol").nth(0).bounding_box(); tb2 = await samp.locator("ol").nth(1).bounding_box()
        ok("stacked rounds: the second round sits below the first, not beside it", tb2["y"] > tb["y"] + tb["height"] - 1)
        ok("tap targets are at least 44px", await sim_btn(pg).evaluate("e=>e.getBoundingClientRect().height") >= 44 and (await samp.get_by_label("Show round").bounding_box())["height"] >= 44)
        await pg.screenshot(path=f"{SHOTS}/after-bracket-phone.png", full_page=True)
        await pg.close()
        pg = await new_page(mctx, E, lineup=FIVE); await goto(pg)
        await sim_btn(pg).tap(); await results(pg).wait_for(timeout=30000)
        ok("unsupported lineup at phone width: number first, note attached, no overflow", await no_hscroll(pg) and UNLIKE in await vis(pg) and ROUGH in await vis(pg))
        await pg.screenshot(path=f"{SHOTS}/after-season-unsupported-phone.png", full_page=True)
        await pg.close(); await mctx.close()

        # ---------- enlarged text (200% root font) ----------
        ectx = await new_context(b, viewport={"width": 1300, "height": 900})
        pg = await new_page(ectx, E); await goto(pg)
        await pg.add_style_tag(content="html{font-size:200% !important}")
        await settle(pg)
        await run(pg)
        ok("with enlarged text the results still fit without sideways scrolling", await no_hscroll(pg))
        await pg.close(); await ectx.close()

        # ---------- season honors ----------
        pg = await ctx.new_page(); E.attach(pg)
        async def honors(pid, season):
            await pg.goto(f"{B}/player/{pid}/{season}")
            await pg.wait_for_selector('[data-testid="season-honors"]', timeout=15000)
            await pg.wait_for_function("!document.querySelector('[data-testid=season-honors]').textContent.includes('Loading honors')", timeout=15000)
            sec = pg.locator('[data-testid="season-honors"]')
            return await sec.inner_text(), await sec.text_content() or ""
        (v05, t05), (v06, t06), (v07, t07) = await honors("nashst01", 2005), await honors("nashst01", 2006), await honors("nashst01", 2007)
        ok("Nash 2004-05 shows MVP", "Most Valuable Player" in v05, v05)
        ok("Nash 2005-06 shows MVP", "Most Valuable Player" in v06, v06)
        ok("Nash 2006-07 does not inherit MVP", "Most Valuable Player" not in v07, v07)
        await pg.screenshot(path=f"{SHOTS}/after-honors-nash-2005.png")
        vl, tl = await honors("jamesle01", 2013)
        ok("another player-season renders honors (LeBron 2012-13: MVP, All-NBA First Team)", "Most Valuable Player" in vl and "All-NBA First Team" in vl, vl)
        ok("honors are compact badges; the roster explanation and sources are under 'About these honors'", await pg.locator('[data-testid="about-honors"]').count() == 1 and not await pg.locator('[data-testid="about-honors"]').evaluate("e=>e.open") and "On the championship roster" in vl and "never change any score or simulation" not in vl and "never change any score or simulation" in tl and "checked against two sources" in tl and len(vl) < 400, len(vl))
        ok("a Finals MVP is on the championship roster and the roster fact is explained (in details)", "Finals MVP" in vl and "On the championship roster" in vl and "never change any score or simulation" in tl, tl)
        va, ta = await honors("allenra02", 2013)
        ok("a champion player who is not a verified roster member reads as a playoff appearance, never as a ring", "Played in the playoffs for the champion" in va and "On the championship roster" not in va and re.search(r"Played in the playoffs for the champion:\s*with MIA", ta, re.I) and "Finals MVP" not in va, (va, ta[-400:]))
        vn, tn = await honors("nashst01", 2007)
        ok("a non-champion season never shows a champion or roster badge", "On the championship roster" not in vn and "Played in the playoffs for the champion" not in vn, vn)
        v26, t26 = await honors("gilgesh01", 2026)
        ok("2025-26 shows MVP, All-NBA First Team and All-Star", "Most Valuable Player" in v26 and "All-NBA First Team" in v26 and "All-Star" in v26 and "incomplete" not in v26, v26)
        vb, tb_ = await honors("brunsja01", 2026)
        ok("2025-26 Finals MVP, All-NBA Second Team and roster membership are shown for the champion", "Finals MVP" in vb and "All-NBA Second Team" in vb and "On the championship roster" in vb, vb)
        vq, tq = await honors("abdulma02", 1998)
        ok("a covered season with nothing says 'No recorded honors'", "No recorded honors" in vq, vq)
        await pg.screenshot(path=f"{SHOTS}/after-honors-none-1998.png")
        # honors download failure: only that section fails, with Retry
        pg2 = await ctx.new_page(); E3 = Errors(); E3.expect_injected(r"honors\.json"); E3.attach(pg2)
        await pg2.route("**/upload.wikimedia.org/**", lambda r: r.abort())
        hfail = {"n": 0}
        async def hf(route):
            if hfail["n"] == 0: hfail["n"] += 1; await route.abort()
            else: await route.continue_()
        await pg2.route("**/data/honors.json", hf)
        await pg2.goto(f"{B}/player/nashst01/2005")
        await pg2.locator('[data-testid="honors-error"]').wait_for(timeout=15000)
        ok("a failed honors download leaves the profile working and offers Retry", (await pg2.locator("h1").first.inner_text()).lower() == "steve nash" and await pg2.locator('[data-testid="honors-error"]').get_by_role("button", name="Retry").count() == 1)
        await pg2.locator('[data-testid="honors-error"]').get_by_role("button", name="Retry").click()
        await pg2.wait_for_function("document.querySelector('[data-testid=season-honors]').textContent.includes('Most Valuable Player')", timeout=15000)
        ok("Retry brings the honors back without reloading", True)
        await pg2.close(); await pg.close()

        ok("no unexpected page errors (injected and external failures are counted separately)", not E.app and not E3.app, (E.app[:3], E3.app[:3]))
        await b.close()
    finish(f"{E.summary()}; honors-test {E3.summary()}; retry-test {E2.summary()}")

asyncio.run(main())
