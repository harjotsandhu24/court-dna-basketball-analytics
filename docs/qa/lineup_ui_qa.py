"""Browser QA for Build a Lineup (court positions) and the simplified navigation/footer.
Chromium only (Playwright): real mouse, keyboard and touch input.
Needs `npm run build && npx next start -p 3100` and `pip install playwright`.
Usage: QA_BASE=http://localhost:3100 python3 docs/qa/lineup_ui_qa.py
Writes screenshots to docs/screenshots/phase9/. Exit code 1 if any check fails."""
import asyncio, json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from qa_common import settle, new_context

B = os.environ.get("QA_BASE", "http://localhost:3100")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, "public", "data")
SHOTS = os.path.join(ROOT, "docs", "screenshots", "phase11")
os.makedirs(SHOTS, exist_ok=True)
idx = json.load(open(f"{DATA}/players_index.json"))
CODES = ["PG", "SG", "SF", "PF", "C"]
res = []
_season_cache = {}

def ok(name, cond, detail=""):
    res.append(bool(cond))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f" -- {str(detail)[:300]}"), flush=True)

def pid(name): return next(k for k, v in idx.items() if v["name"] == name)
def season_rows(s):
    if s not in _season_cache: _season_cache[s] = json.load(open(f"{DATA}/seasons/{s}.json"))
    return _season_cache[s]
def rec(p, s): return next(r for r in season_rows(s) if r["player_id"] == p)
def z2p(z):
    t = 1 / (1 + 0.2316419 * abs(z)); d = 0.3989423 * math.exp(-z * z / 2)
    p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
    if z > 0: p = 1 - p
    return max(0, min(100, p * 100))
KEYS = ["Playmaking", "Perimeter Profile", "Rim Pressure", "Rebounding", "Defensive Activity", "__ball_dominance"]
LABELS = ["Passing & Creation", "Three-Point Shooting", "Attacking the Basket", "Rebounding", "Defensive box-score signals", "How Much They Handle the Ball"]
def val(r, k): return z2p(r["vector"]["usg_percent"]) if k == "__ball_dominance" else r["traits"][k]
def expected(pairs):
    rs = [rec(p, s) for p, s in pairs]
    return [str(round(sum(val(r, k) for r in rs) / len(rs))) for k in KEYS]

NAMES = ["Matisse Thybulle", "LeBron James", "Stephen Curry", "Kevin Durant", "Nikola Jokić"]
SEARCH = {"Matisse Thybulle": "thybulle", "LeBron James": "lebron james", "Stephen Curry": "stephen curry", "Kevin Durant": "kevin durant", "Nikola Jokić": "jokic"}

def spot(pg, code): return pg.locator(f'button[data-slot="{code}"]')
async def stext(pg, code):
    import re
    t = (await spot(pg, code).inner_text()).replace("\n", " | ")
    return re.sub(r"^(PG|SG|SF|PF|C) \| ", "", t)  # drop the position chip so spots can be compared
def sfrag(season_end): return f"{season_end - 1}-{str(season_end)[-2:]}"
async def season_of(pg, code):
    t = await spot(pg, code).inner_text()
    import re
    m = re.search(r"(\d{4})-(\d{2})", t)
    return (int(m.group(1)) + 1) if m else None
async def scores(pg):
    out = []
    for l in LABELS:
        row = pg.locator(f"xpath=//span[text()='{l}']/..")
        if await row.count() == 0: return None
        out.append(await row.locator("span").nth(1).inner_text())
    return out
async def goto(pg, path="/build-a-five"):
    await pg.goto(B + path); await pg.wait_for_selector('button[data-slot="PG"]' if "build" in path else "body"); await settle(pg)
async def pick(pg, name, query=None):
    box = pg.get_by_role("combobox"); await box.fill(query or SEARCH.get(name, name)); await settle(pg)
    await pg.get_by_role("option").filter(has_text=name).first.click()
async def add_to(pg, code, name, query=None):
    await spot(pg, code).click(); await settle(pg)
    await pick(pg, name, query)
    # wait for the add to finish (filled, or failed): no position is still marked busy
    await pg.wait_for_function("!document.querySelector('button[data-slot][aria-busy=true]')", timeout=20000)
    await settle(pg)
def alert(pg): return pg.locator("p[role=alert]")
async def alert_text(pg): return (await alert(pg).inner_text()) if await alert(pg).count() else ""
def delay(ms, counter=None):
    async def h(route):
        if counter is not None:
            counter["n"] = counter.get("n", 0) + 1
        await asyncio.sleep(ms / 1000); await route.continue_()
    return h
async def new_page(ctx, routes=()):
    pg = await ctx.new_page()
    # Start every test page with no saved lineup; the sessionStorage flag lets reloads inside one test keep it.
    await pg.add_init_script("try{if(!sessionStorage.getItem('qa_init')){localStorage.clear();sessionStorage.setItem('qa_init','1')}}catch(e){}")
    await pg.route("**/upload.wikimedia.org/**", lambda r: r.abort())
    for pat, h in routes: await pg.route(pat, h)
    return pg
async def fill_five(pg, order=None):
    for code, name in zip(CODES, order or NAMES): await add_to(pg, code, name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await new_context(b, viewport={"width": 1300, "height": 900})
        errs = []

        # ---------- empty state, adding to each spot ----------
        pg = await new_page(ctx); pg.on("pageerror", lambda e: errs.append(str(e)))
        await goto(pg)
        ok("five empty spots with accessible names", all([("empty. Add player" in (await spot(pg, c).get_attribute("aria-label"))) for c in CODES]) and await pg.locator("button[data-slot]").count() == 5)
        await pg.screenshot(path=f"{SHOTS}/desktop-empty.png", full_page=True)
        # hover highlight
        sg = spot(pg, "SG"); before = await sg.evaluate("e=>getComputedStyle(e).borderColor+'|'+getComputedStyle(e).backgroundColor")
        await sg.hover(); await settle(pg)
        after = await sg.evaluate("e=>getComputedStyle(e).borderColor+'|'+getComputedStyle(e).backgroundColor")
        ok("hover highlights a position", before != after, (before, after))
        await pg.mouse.move(5, 5)
        for code, name in zip(CODES, NAMES):
            await add_to(pg, code, name)
            t = await stext(pg, code)
            ok(f"add to {code}: photo/name/season shown", name.split()[-1] in t and await season_of(pg, code) is not None, t)
        pairs = [(pid(n), await season_of(pg, c)) for c, n in zip(CODES, NAMES)]
        ok("Thybulle defaults to latest season 2025-26 with Small sample label", pairs[0][1] == 2026 and "Small sample" in await stext(pg, "PG"), await stext(pg, "PG"))
        ok("scores match the data for the five player-seasons", await scores(pg) == expected(pairs), (await scores(pg), expected(pairs)))
        ok("full lineup heading", "Full Five" in await pg.content())
        base = await scores(pg)
        await pg.screenshot(path=f"{SHOTS}/desktop-full.png", full_page=True)

        # ---------- controls, season change ----------
        await spot(pg, "PG").click(); await settle(pg)
        panel = pg.locator("section[aria-label='Controls for PG']")
        txt = await panel.inner_text()
        ok("occupied spot opens controls (change player, season, move, remove)", all(w in txt for w in ["Change player", "Move", "Remove", "Season", "Close"]) and "Limited playing time. These stats may be less reliable." in txt, txt)
        await pg.screenshot(path=f"{SHOTS}/desktop-controls.png", full_page=True)
        sel = pg.locator(f"{'section[aria-label=\"Controls for PG\"]'} select")
        opts = await sel.locator("option").all_inner_texts()
        ok("season list has all 7 seasons, small-sample labels on the two newest", len(opts) == 7 and "Small sample" in opts[-1] and "Small sample" in opts[-2] and not any("Small sample" in o for o in opts[:5]), opts)
        await sel.select_option("2025"); await settle(pg)
        pairs[0] = (pairs[0][0], 2025)
        ok("season change updates the spot and the scores", await season_of(pg, "PG") == 2025 and await scores(pg) == expected(pairs), (await stext(pg, "PG"), await scores(pg)))
        await sel.select_option("2026"); await settle(pg); pairs[0] = (pairs[0][0], 2026)
        ok("switching back restores the scores", await scores(pg) == base)

        # ---------- duplicate prevention ----------
        await panel.get_by_role("button", name="Change player", exact=True).click(); await settle(pg)
        await pick(pg, "LeBron James"); await settle(pg)
        ok("replace with a player already in the lineup is blocked with a message", "already in your lineup" in await alert_text(pg) and "Thybulle" in await stext(pg, "PG") and await scores(pg) == base, await alert_text(pg))
        await pg.keyboard.press("Escape"); await settle(pg); await pg.keyboard.press("Escape"); await settle(pg)
        ok("Escape closes the controls", await pg.locator("section[aria-label^='Controls for']").count() == 0)

        # ---------- remove ----------
        await spot(pg, "C").click(); await settle(pg)
        await pg.get_by_role("button", name="Remove", exact=True).click(); await settle(pg)
        ok("remove empties the spot and updates the scores", "empty" in (await spot(pg, "C").get_attribute("aria-label")) and await scores(pg) == expected(pairs[:4]), await scores(pg))
        ok("focus returns to the spot after removing", await pg.evaluate("document.activeElement?.dataset?.slot") == "C")
        # add back an already-present player into the now empty spot -> duplicate blocked
        await spot(pg, "C").click(); await settle(pg); await pick(pg, "Kevin Durant"); await settle(pg)
        ok("duplicate add into an empty spot is blocked", "already in your lineup" in await alert_text(pg) and "empty" in (await spot(pg, "C").get_attribute("aria-label")))
        await pick(pg, "Nikola Jokić", "jokic"); await settle(pg)
        ok("then a different player can be added there", "Joki" in await stext(pg, "C"))
        ok("never more than five unique players", await pg.locator("button[data-slot]").count() == 5)

        # ---------- move / swap / cancel ----------
        base = await scores(pg)
        seasons_before = {c: await season_of(pg, c) for c in CODES}
        names_before = {c: (await stext(pg, c)) for c in CODES}
        await spot(pg, "SG").click(); await settle(pg)
        await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
        banner = await pg.locator("text=Moving").first.inner_text()
        ok("move mode names the player being moved", "LeBron" in banner or "James" in banner, banner)
        await pg.screenshot(path=f"{SHOTS}/desktop-moving.png", full_page=True)
        await pg.keyboard.press("Escape"); await settle(pg)
        ok("Escape cancels a move; nothing changes", await pg.get_by_text("Cancel move").count() == 0 and await stext(pg, "SG") == names_before["SG"])
        await spot(pg, "SG").click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
        await pg.get_by_role("button", name="Cancel move").click(); await settle(pg)
        ok("Cancel button cancels a move", await pg.get_by_text("Cancel move").count() == 0)
        await spot(pg, "SG").click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
        await spot(pg, "SG").click(); await settle(pg)
        ok("clicking the moving spot cancels the move", await pg.get_by_text("Cancel move").count() == 0)
        # swap SG <-> PF
        await spot(pg, "SG").click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
        await spot(pg, "PF").click(); await settle(pg)
        ok("swap exchanges players and keeps their seasons", await stext(pg, "SG") == names_before["PF"] and await stext(pg, "PF") == names_before["SG"] and await season_of(pg, "SG") == seasons_before["PF"] and await season_of(pg, "PF") == seasons_before["SG"], (await stext(pg, "SG"), await stext(pg, "PF")))
        ok("scores unchanged after a swap", await scores(pg) == base, (await scores(pg), base))
        # move into empty: remove SF then move PG -> SF
        await spot(pg, "SF").click(); await pg.get_by_role("button", name="Remove", exact=True).click(); await settle(pg)
        s3 = await scores(pg); pg_before = await stext(pg, "PG"); pg_season = await season_of(pg, "PG")
        await spot(pg, "PG").click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
        await spot(pg, "SF").click(); await settle(pg)
        ok("move into an empty spot preserves the season and leaves the old spot empty", await stext(pg, "SF") == pg_before and await season_of(pg, "SF") == pg_season and "empty" in (await spot(pg, "PG").get_attribute("aria-label")), await stext(pg, "SF"))
        ok("scores unchanged after moving", await scores(pg) == s3)
        # refill and do many rearrangements, scores identical
        await add_to(pg, "PG", "LeBron James")  # was removed? LeBron stays in SG/PF; use fresh name instead
        # (LeBron is in the lineup so this is a duplicate -> blocked; use Joel Embiid)
        await pick(pg, "Joel Embiid", "joel embiid"); await settle(pg)
        full = await scores(pg); pr = None
        for a, c in [("PG", "SG"), ("SG", "SF"), ("SF", "PF"), ("PF", "C"), ("C", "PG"), ("PG", "PF"), ("SG", "C")]:
            await spot(pg, a).click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
            await spot(pg, c).click(); await settle(pg)
        ok("scores identical after seven rearrangements of the same five", await scores(pg) == full, (await scores(pg), full))
        ok("note is shown: positions don't affect scores", "Positions help you arrange your lineup. They don’t affect the scores." in await pg.content())

        # ---------- replace (original kept until the replacement loads), failure ----------
        only25 = [k for k, v in idx.items() if max(v["seasons"]) == 2025 and sum(1 for w in idx.values() if w["name"] == v["name"]) == 1 and v["qualified_seasons"]]
        repl = idx[only25[0]]["name"]; repl_id = only25[0]
        await pg.close()
        c = {}
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(4000, c))]); pg.on("pageerror", lambda e: errs.append(str(e)))
        await goto(pg); await add_to(pg, "PG", "LeBron James")
        lj_scores = await scores(pg); lj_text = await stext(pg, "PG")
        await spot(pg, "PG").click(); await pg.get_by_role("button", name="Change player", exact=True).click(); await settle(pg)
        await pick(pg, repl, repl); await settle(pg, 1)
        ok("while a replacement loads, the original stays and the spot shows loading", "LeBron" in await stext(pg, "PG") and await spot(pg, "PG").get_attribute("aria-busy") == "true", await stext(pg, "PG"))
        ok("while loading, the search input is locked and other spots ignore clicks", await pg.get_by_role("combobox").is_disabled())
        busy_now = await spot(pg, "PG").get_attribute("aria-busy")
        # force: Playwright would otherwise wait for the aria-disabled spot to become enabled (i.e. until loading ends)
        await spot(pg, "SG").click(force=True); await settle(pg, 1)
        ok("clicking another spot while loading does nothing", busy_now == "true" and await spot(pg, "PG").get_attribute("aria-busy") == "true" and await pg.locator("section[aria-label='Controls for SG']").count() == 0, busy_now)
        await settle(pg)
        ok("replacement lands at the same spot", repl.split()[-1] in await stext(pg, "PG") and "LeBron" not in await stext(pg, "PG") and await pg.locator("button[data-slot]").count() == 5, await stext(pg, "PG"))
        ok("replacement uses the player's latest season", await season_of(pg, "PG") == 2025)
        ok("scores now reflect the replacement", await scores(pg) == expected([(repl_id, 2025)]), await scores(pg))
        await pg.close()
        # failure keeps the lineup
        pg = await new_page(ctx, [("**/data/seasons/2025.json", lambda r: r.abort())]); pg.on("pageerror", lambda e: errs.append(str(e)))
        await goto(pg); await add_to(pg, "PG", "LeBron James")
        keep = await stext(pg, "PG"); keep_scores = await scores(pg)
        await spot(pg, "PG").click(); await pg.get_by_role("button", name="Change player", exact=True).click(); await settle(pg)
        await pick(pg, repl, repl); await settle(pg)
        ok("failed replacement: clear message, original kept, scores unchanged", "Couldn’t load" in await alert_text(pg) and "Kept LeBron James in PG" in await alert_text(pg) and await stext(pg, "PG") == keep and await scores(pg) == keep_scores, await alert_text(pg))
        ok("failed replacement: not left locked", not await pg.get_by_role("combobox").is_disabled())
        await pg.close()
        # failed add
        pg = await new_page(ctx, [("**/data/seasons/2026.json", lambda r: r.abort())])
        await goto(pg); await add_to(pg, "SG", "LeBron James")
        ok("failed add: message, spot stays empty", "Couldn’t load LeBron James" in await alert_text(pg) and "empty" in (await spot(pg, "SG").get_attribute("aria-label")), await alert_text(pg))
        await pg.close()
        # failed season change
        pg = await new_page(ctx, [("**/data/seasons/2025.json", lambda r: r.abort())])
        await goto(pg); await add_to(pg, "SG", "LeBron James")
        await spot(pg, "SG").click(); await pg.locator("section[aria-label='Controls for SG'] select").select_option("2025"); await settle(pg)
        ok("failed season change: message, shown season unchanged", "Couldn’t load" in await alert_text(pg) and await season_of(pg, "SG") == 2026, await alert_text(pg))
        await pg.close()
        # missing record
        async def drop(route):
            r = await route.fetch(); d = await r.json(); lj = pid("LeBron James")
            await route.fulfill(response=r, body=json.dumps([x for x in d if x["player_id"] != lj]))
        pg = await new_page(ctx, [("**/data/seasons/2026.json", drop)])
        await goto(pg); await add_to(pg, "SG", "LeBron James")
        ok("missing record: message, spot stays empty", "No 2025-26 record found" in await alert_text(pg) and "empty" in (await spot(pg, "SG").get_attribute("aria-label")), await alert_text(pg))
        await pg.close()
        # missing stat -> Unavailable
        async def nulltrait(route):
            r = await route.fetch(); d = await r.json(); lj = pid("LeBron James")
            for x in d:
                if x["player_id"] == lj: x["traits"]["Rebounding"] = None
            await route.fulfill(response=r, body=json.dumps(d))
        pg = await new_page(ctx, [("**/data/seasons/2026.json", nulltrait)])
        await goto(pg); await add_to(pg, "SG", "LeBron James")
        sc = await scores(pg)
        ok("missing stat shows Unavailable, not zero", sc and sc[3] == "Unavailable" and all(x != "Unavailable" for i, x in enumerate(sc) if i != 3), sc)
        await pg.close()

        # ---------- rapid actions, cancellation during loading ----------
        c = {}
        pg = await new_page(ctx, [("**/data/seasons/2026.json", delay(1800, c))])
        await goto(pg)
        await spot(pg, "PG").click(); await settle(pg)
        await pg.get_by_role("combobox").fill("thybulle"); await settle(pg)
        opt = pg.get_by_role("option").filter(has_text="Matisse Thybulle").first
        await opt.click(); await opt.click(force=True, timeout=500) if await opt.count() else None
        await settle(pg, 1)
        ok("repeated clicks while loading are ignored and the input is locked", await pg.get_by_role("combobox").is_disabled())
        await pg.keyboard.press("Escape"); await settle(pg, 1)
        ok("Escape during loading cancels the request (panel stays open, input usable)", not await pg.get_by_role("combobox").is_disabled() and await pg.locator("section[aria-label='Controls for PG']").count() == 1)
        await pg.keyboard.press("Escape"); await settle(pg, 1)
        # now add a different player at SG while the cancelled PG request is still in flight
        await spot(pg, "SG").click(); await settle(pg); await pick(pg, "LeBron James"); await settle(pg, 2)
        await settle(pg)
        ok("a cancelled response never fills the old spot", "empty" in (await spot(pg, "PG").get_attribute("aria-label")), await stext(pg, "PG"))
        ok("the newer pick filled the right spot", "James" in await stext(pg, "SG"), await stext(pg, "SG"))
        ok("exactly one player in the lineup", sum([1 for cc in CODES if "empty" not in (await spot(pg, cc).get_attribute("aria-label"))]) == 1)
        await pg.close()
        # Cancel loading button
        pg = await new_page(ctx, [("**/data/seasons/2026.json", delay(1500))])
        await goto(pg); await spot(pg, "C").click(); await pick(pg, "LeBron James"); await settle(pg, 1)
        await pg.get_by_role("button", name="Cancel loading").click(); await settle(pg)
        ok("Cancel loading button stops the add; late response ignored", "empty" in (await spot(pg, "C").get_attribute("aria-label")))
        await pg.close()
        # rapid season changes: slow older response must not win
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(2000)), ("**/data/seasons/2024.json", delay(100))])
        await goto(pg); await add_to(pg, "SG", "Matisse Thybulle")
        await spot(pg, "SG").click(); sel = pg.locator("section[aria-label='Controls for SG'] select")
        await sel.select_option("2025"); await settle(pg, 1); await sel.select_option("2024"); await settle(pg)
        ok("rapid season changes: the newest choice wins", await season_of(pg, "SG") == 2024 and await scores(pg) == expected([(pid("Matisse Thybulle"), 2024)]), (await stext(pg, "SG"), await scores(pg)))
        await pg.close()
        # remove / move during an in-flight season change
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(1500))])
        await goto(pg); await add_to(pg, "SG", "Matisse Thybulle")
        await spot(pg, "SG").click(); await pg.locator("section[aria-label='Controls for SG'] select").select_option("2025"); await settle(pg, 1)
        await pg.get_by_role("button", name="Remove", exact=True).click(); await settle(pg)
        ok("a removed player is not restored by a late season response", all([("empty" in (await spot(pg, cc).get_attribute("aria-label"))) for cc in CODES]))
        await pg.close()
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(1500))])
        await goto(pg); await add_to(pg, "SG", "Matisse Thybulle")
        await spot(pg, "SG").click(); await pg.locator("section[aria-label='Controls for SG'] select").select_option("2025"); await settle(pg, 1)
        await pg.get_by_role("button", name="Move", exact=True).click(); await spot(pg, "C").click(); await settle(pg)
        ok("a player moved during a season change gets the new season in their new spot", "Thybulle" in await stext(pg, "C") and await season_of(pg, "C") == 2025 and "empty" in (await spot(pg, "SG").get_attribute("aria-label")), (await stext(pg, "C"), await stext(pg, "SG")))
        await pg.close()

        # ---------- keyboard ----------
        pg = await new_page(ctx); await goto(pg)
        await spot(pg, "PG").focus()
        outline = await spot(pg, "PG").evaluate("e=>getComputedStyle(e).outlineStyle+' '+getComputedStyle(e).outlineWidth")
        await pg.keyboard.press("Tab"); await pg.keyboard.press("Shift+Tab"); await settle(pg)
        outline = await spot(pg, "PG").evaluate("e=>[getComputedStyle(e).outlineStyle,getComputedStyle(e).outlineWidth,getComputedStyle(e).borderRadius].join(' ')")
        ok("keyboard focus shows a clear 2px outline and keeps the rounded shape", outline.startswith("solid 2px") and not outline.endswith(" 2px"), outline)
        await pg.keyboard.press("Enter"); await settle(pg)
        ok("Enter opens the add controls with the search focused", await pg.evaluate("document.activeElement?.getAttribute('role')") == "combobox")
        await pg.keyboard.type("lebron james"); await pg.get_by_role("option").first.wait_for(); await settle(pg); await pg.keyboard.press("Enter"); await settle(pg)
        ok("keyboard add works and focus returns to the spot", "James" in await stext(pg, "PG") and await pg.evaluate("document.activeElement?.dataset?.slot") == "PG")
        await pg.keyboard.press("Space"); await settle(pg)
        ok("Space opens the controls for an occupied spot", await pg.locator("section[aria-label='Controls for PG']").count() == 1)
        await pg.keyboard.press("Escape"); await settle(pg)
        ok("Escape closes the controls and focus returns to the spot", await pg.locator("section[aria-label^='Controls']").count() == 0 and await pg.evaluate("document.activeElement?.dataset?.slot") == "PG")
        await pg.keyboard.press("Tab"); await pg.keyboard.press("Enter"); await settle(pg)  # SG empty -> search
        await pg.keyboard.type("kevin durant"); await pg.get_by_role("option").first.wait_for(); await settle(pg); await pg.keyboard.press("Enter"); await settle(pg)
        # keyboard move/swap: focus PG, Enter, Tab to Move, Enter, then Tab to SG, Enter
        await spot(pg, "PG").focus(); await pg.keyboard.press("Enter"); await settle(pg)
        await pg.get_by_role("button", name="Move", exact=True).focus(); await pg.keyboard.press("Enter"); await settle(pg)
        ok("keyboard Move: focus is on the moving spot", await pg.evaluate("document.activeElement?.dataset?.slot") == "PG")
        await pg.keyboard.press("Tab"); await pg.keyboard.press("Enter"); await settle(pg)
        ok("keyboard swap works (SG now has LeBron, PG has Durant)", "James" in await stext(pg, "SG") and "Durant" in await stext(pg, "PG"), (await stext(pg, "PG"), await stext(pg, "SG")))
        await pg.close()

        # ---------- wording with 3, 4 and 5 players; observations stay put when rearranged ----------
        groups = {}
        for r in season_rows(2026):
            if r["qualified"] and sum(1 for w in idx.values() if w["name"] == r["player"]) == 1: groups.setdefault(r["pos_group"], []).append(r)
        gname = "Guard" if len(groups.get("Guard", [])) >= 5 else max(groups, key=lambda k: len(groups[k]))
        same = [r["player"] for r in groups[gname][:5]]
        pg = await new_page(ctx); await goto(pg)
        OBS = "xpath=//p[text()='Observations']/following-sibling::ul//li"
        async def obs_text(): return [t.lstrip("• ").strip() for t in await pg.locator(OBS).all_inner_texts()]
        for n, code in zip([1, 2, 3, 4, 5], CODES):
            await add_to(pg, code, same[n - 1], same[n - 1])
            if n >= 3:
                o = await obs_text(); before_scores = await scores(pg)
                ok(f"{n} players: wording reads 'All selected players share one position group ({gname})'", f"All selected players share one position group ({gname})" in o and "All five" not in await pg.content(), o)
                a, c2 = CODES[0], CODES[n - 1]
                await spot(pg, a).click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
                await spot(pg, c2).click(); await settle(pg)
                ok(f"{n} players: swapping leaves scores and observation text unchanged", await obs_text() == o and await scores(pg) == before_scores, (await obs_text(), o))
        await pg.close()

        # ---------- "How this is calculated" link ----------
        pg = await new_page(ctx); await goto(pg); await add_to(pg, "PG", "Matisse Thybulle")
        link = pg.get_by_role("link", name="How this is calculated", exact=True)
        card_box = await pg.locator("xpath=//p[text()='Lineup Identity Card']/..").bounding_box(); lb = await link.bounding_box()
        last_bar = await pg.locator("xpath=//span[text()='How Much They Handle the Ball']/../..").bounding_box()
        ok("link sits below the lineup scores, inside the card", lb["y"] >= last_bar["y"] + last_bar["height"] - 1 and lb["y"] <= card_box["y"] + card_box["height"], (lb, last_bar))
        ok("link points at /methodology#lineup-scores", (await link.get_attribute("href")) == "/methodology#lineup-scores")
        await link.focus()
        ol = await link.evaluate("e=>getComputedStyle(e).outlineStyle+' '+getComputedStyle(e).outlineWidth")
        await pg.keyboard.press("Tab"); await pg.keyboard.press("Shift+Tab")
        ol = await link.evaluate("e=>getComputedStyle(e).outlineStyle+' '+getComputedStyle(e).outlineWidth")
        ok("link is keyboard-focusable with a visible focus ring", ol.startswith("solid") and await pg.evaluate("document.activeElement?.textContent?.trim()") == "How this is calculated", ol)
        await pg.keyboard.press("Enter"); await settle(pg)
        ok("Enter follows the link to the explanation", pg.url == B + "/methodology#lineup-scores", pg.url)
        # the page scrolls smoothly: wait until the heading has actually arrived (or time out and fail below)
        try:
            await pg.wait_for_function("(()=>{const h=document.querySelector('#lineup-scores h2');if(!h)return false;const y=h.getBoundingClientRect().y;return y>=40&&y<=260})()", timeout=8000)
        except Exception:
            pass
        hb = await pg.locator("#lineup-scores h2").bounding_box()
        ok("the explanation heading is scrolled into view below the sticky header", hb is not None and 40 <= hb["y"] <= 260, hb)
        text = await pg.locator("#lineup-scores").inner_text()
        ok("explanation covers averages, positions, missing stats, small samples and no predictions",
           all(w in text for w in ["plain average", "Positions don’t affect scores", "Unavailable", "never counted as zero", "Small sample", "limited playing time", "aren’t used to predict wins"]), text[:400])
        await pg.go_back(); await settle(pg)
        ok("Back returns to the lineup, which is still there", "Thybulle" in await stext(pg, "PG"))
        await pg.close()

        # ---------- saved lineup ----------
        pg = await new_page(ctx); await goto(pg)
        await add_to(pg, "SG", "LeBron James"); await add_to(pg, "C", "Matisse Thybulle"); await add_to(pg, "PG", "Stephen Curry")
        await spot(pg, "C").click(); await pg.locator("section[aria-label='Controls for C'] select").select_option("2024"); await settle(pg)
        await pg.keyboard.press("Escape")
        snap = {c: await stext(pg, c) for c in CODES}; sc0 = await scores(pg)
        await pg.reload(); await pg.wait_for_selector('button[data-slot="PG"]'); await settle(pg)
        ok("refresh keeps the lineup: same positions, players and seasons", {c: await stext(pg, c) for c in CODES} == snap, {c: await stext(pg, c) for c in CODES})
        ok("refresh keeps the scores", await scores(pg) == sc0)
        # clear lineup: confirm / cancel
        ok("Clear lineup button is shown once there are players", await pg.get_by_role("button", name="Clear lineup", exact=True).count() == 1)
        await pg.get_by_role("button", name="Clear lineup", exact=True).click(); await settle(pg)
        ok("clear asks for confirmation and focuses the safe choice", await pg.locator("[role=group][aria-label='Confirm clear lineup']").count() == 1 and (await pg.evaluate("document.activeElement?.textContent?.trim()")) == "Keep lineup")
        await pg.keyboard.press("Escape"); await settle(pg)
        ok("Escape cancels the confirmation, keeps the lineup and returns focus to the button", await pg.locator("[role=group][aria-label='Confirm clear lineup']").count() == 0 and {c: await stext(pg, c) for c in CODES} == snap and (await pg.evaluate("document.activeElement?.textContent?.trim()")) == "Clear lineup")
        await pg.get_by_role("button", name="Clear lineup", exact=True).click(); await pg.get_by_role("button", name="Keep lineup", exact=True).click(); await settle(pg)
        ok("Keep lineup leaves everything as it was", {c: await stext(pg, c) for c in CODES} == snap)
        await pg.get_by_role("button", name="Clear lineup", exact=True).click(); await pg.get_by_role("button", name="Yes, clear lineup", exact=True).click(); await settle(pg)
        ok("confirming clears every position and the scores", all([("empty" in (await spot(pg, cc).get_attribute("aria-label"))) for cc in CODES]) and await scores(pg) is None)
        ok("clearing also forgets the saved lineup", await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')") is None)
        await pg.reload(); await pg.wait_for_selector('button[data-slot="PG"]'); await settle(pg)
        ok("a cleared lineup stays cleared after refresh", all([("empty" in (await spot(pg, cc).get_attribute("aria-label"))) for cc in CODES]))
        await pg.close()
        # clear while a season change is loading: the late response must not bring anyone back
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(1500))]); await goto(pg); await add_to(pg, "SG", "Matisse Thybulle")
        await spot(pg, "SG").click(); await pg.locator("section[aria-label='Controls for SG'] select").select_option("2025"); await settle(pg, 1)
        await pg.get_by_role("button", name="Clear lineup", exact=True).click(); await pg.get_by_role("button", name="Yes, clear lineup", exact=True).click(); await settle(pg)
        ok("clearing during a season change: nobody comes back, nothing is re-saved", all([("empty" in (await spot(pg, cc).get_attribute("aria-label"))) for cc in CODES]) and await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')") is None)
        await pg.close()
        # restoring bad / unavailable saved data
        thy_id = pid("Matisse Thybulle"); lj_id = pid("LeBron James")
        async def seeded(payload, routes=()):
            pg = await new_page(ctx, routes); await pg.goto(B + "/"); await settle(pg)
            await pg.evaluate("v=>localStorage.setItem('courtdna.lineup.v1', v)", payload); await goto(pg); await settle(pg); return pg
        pg = await seeded(json.dumps({"v": 1, "slots": [{"id": thy_id, "season": 2026}, {"id": "nobody99", "season": 2020}, {"id": lj_id, "season": 2000}, None, {"id": pid("Stephen Curry"), "season": 2016}]}))
        msg = await alert_text(pg)
        ok("valid saved players restored at their positions", "Thybulle" in await stext(pg, "PG") and "Curry" in await stext(pg, "C") and await season_of(pg, "C") == 2016)
        ok("unavailable saved entries are skipped with a clear message", "Skipped" in msg and "a saved player (2019-20) at SG" in msg and "no record found" in msg, msg)
        ok("a saved season the player never had is skipped, naming the player", "LeBron James (1999-00) at SF" in msg, msg)
        ok("only the restored players are left in storage", json.loads(await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')"))["slots"][4] is not None and json.loads(await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')"))["slots"][1] is None)
        await pg.close()
        pg = await seeded("{{{not json")
        ok("garbage saved data is ignored without errors and then forgotten", all([("empty" in (await spot(pg, cc).get_attribute("aria-label"))) for cc in CODES]) and await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')") is None)
        await pg.close()
        # restore failure keeps the saved copy; spots are locked; Try again works; Start fresh forgets it
        payload = json.dumps({"v": 1, "slots": [{"id": thy_id, "season": 2026}, None, None, None, None]})
        failing = {"on": True}
        async def flaky(route):
            if failing["on"]: await route.abort()
            else: await route.continue_()
        pg = await seeded(payload, [("**/data/seasons/2026.json", flaky)])
        ok("failed restore: clear message with Try again / Start fresh", "Couldn’t restore your saved lineup" in await pg.locator("[role=alert]").first.inner_text() and await pg.get_by_role("button", name="Try again", exact=True).count() == 1)
        await spot(pg, "SG").click(force=True); await settle(pg)
        ok("failed restore: positions are locked, saved lineup untouched", await pg.locator("section[aria-label^='Controls']").count() == 0 and await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')") == payload)
        failing["on"] = False
        await pg.get_by_role("button", name="Try again", exact=True).click()
        await pg.locator("button[data-slot=PG]:has-text('Thybulle')").wait_for(timeout=15000); await settle(pg)
        ok("Try again restores the lineup", "Thybulle" in await stext(pg, "PG") and await pg.get_by_role("button", name="Try again", exact=True).count() == 0)
        await pg.close()
        failing["on"] = True
        pg = await seeded(payload, [("**/data/seasons/2026.json", flaky)])
        await pg.get_by_role("button", name="Start fresh", exact=True).click(); await settle(pg)
        ok("Start fresh forgets the saved lineup and unlocks the court", await pg.evaluate("localStorage.getItem('courtdna.lineup.v1')") is None and await spot(pg, "PG").get_attribute("aria-disabled") is None)
        await pg.close()
        # blocked storage (private mode): everything still works
        pg = await new_page(ctx)
        await pg.add_init_script("Storage.prototype.setItem=function(){throw new Error('blocked')};Storage.prototype.getItem=function(){throw new Error('blocked')};")
        await goto(pg); await add_to(pg, "PG", "LeBron James")
        ok("blocked storage: the lineup still works and nothing crashes", "James" in await stext(pg, "PG"))
        await pg.close()

        # ---------- scores are marked while something is loading; failures restore a consistent display ----------
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(2500))]); await goto(pg)
        await add_to(pg, "PG", "Matisse Thybulle"); await add_to(pg, "SG", "LeBron James")
        sc_before = await scores(pg); sbox = await spot(pg, "PG").bounding_box()
        await spot(pg, "PG").click(); await pg.locator("section[aria-label='Controls for PG'] select").select_option("2025"); await settle(pg, 1)
        note = await pg.locator("xpath=//p[text()='Lineup Identity Card']/..").inner_text()
        ok("while a season loads, the scores say they still show the previous season", "Updating Matisse Thybulle to 2024-25. The scores below still use 2025-26." in note, note[:300])
        ok("scores are dimmed and marked busy, and have not changed yet", await pg.locator("[aria-busy=true].grid").count() == 1 and await scores(pg) == sc_before)
        ok("the position shows 'Updating…' and keeps its size", "Updating" in await stext(pg, "PG") and (await spot(pg, "PG").bounding_box())["height"] == sbox["height"] and (await spot(pg, "PG").bounding_box())["width"] == sbox["width"], await stext(pg, "PG"))
        await settle(pg)
        ok("after loading: note gone and scores updated", "still use" not in await pg.locator("xpath=//p[text()='Lineup Identity Card']/..").inner_text() and await scores(pg) == expected([(pid("Matisse Thybulle"), 2025), (pid("LeBron James"), await season_of(pg, "SG"))]))
        await pg.close()
        pg = await new_page(ctx, [("**/data/seasons/2025.json", lambda r: r.abort())]); await goto(pg)
        await add_to(pg, "PG", "Matisse Thybulle"); sc_before = await scores(pg); txt_before = await stext(pg, "PG")
        await spot(pg, "PG").click(); await pg.locator("section[aria-label='Controls for PG'] select").select_option("2025"); await settle(pg)
        sel_val = await pg.locator("section[aria-label='Controls for PG'] select").input_value()
        ok("failed season change restores a consistent display (select, spot, scores, no 'updating')", sel_val == "2026" and await stext(pg, "PG") == txt_before and await scores(pg) == sc_before and "still use" not in await pg.content() and "Updating" not in await stext(pg, "PG"), (sel_val, await stext(pg, "PG")))
        await pg.close()
        pg = await new_page(ctx, [("**/data/seasons/2025.json", delay(2500))]); await goto(pg)
        await add_to(pg, "PG", "LeBron James"); lj_ok = await season_of(pg, "PG")
        only25 = [k for k, v in idx.items() if max(v["seasons"]) == 2025 and sum(1 for w in idx.values() if w["name"] == v["name"]) == 1 and v["qualified_seasons"]]
        rname = idx[only25[0]]["name"]
        await spot(pg, "PG").click(); await pg.get_by_role("button", name="Change player", exact=True).click(); await pick(pg, rname, rname); await settle(pg, 1)
        ok("while a replacement loads, scores say they still include the original", "The scores below still include LeBron James." in await pg.locator("xpath=//p[text()='Lineup Identity Card']/..").inner_text())
        await settle(pg); await pg.close()

        # ---------- missing photos: initials, same size, controls still work ----------
        manifest = json.load(open(f"{DATA}/photo_manifest.json"))
        usable = [k for k, v in manifest.items() if v.get("verification_status") == "usable" and v.get("thumbnail_url") and sum(1 for w in idx.values() if w["name"] == idx[k]["name"]) == 1 and 2026 in idx[k]["seasons"]] if manifest else []
        if usable:
            uname = idx[usable[0]]["name"]
            async def slow_fail(route):
                await asyncio.sleep(1.5); await route.abort()
            pg = await ctx.new_page(); await pg.add_init_script("try{if(!sessionStorage.getItem('qa_init')){localStorage.clear();sessionStorage.setItem('qa_init','1')}}catch(e){}")
            await pg.route("**/upload.wikimedia.org/**", slow_fail)
            await goto(pg); await add_to(pg, "PG", uname, uname)
            box1 = await spot(pg, "PG").bounding_box(); has_img = await spot(pg, "PG").locator("img").count()
            await spot(pg, "PG").locator("[data-photo-player] div[aria-hidden='true']").wait_for(timeout=15000)
            box2 = await spot(pg, "PG").bounding_box(); has_init = await spot(pg, "PG").locator("[data-photo-player] div[aria-hidden='true']").count()
            ok(f"photo loading then failing for {uname}: initials appear, card size unchanged", has_img == 1 and has_init == 1 and box1["width"] == box2["width"] and box1["height"] == box2["height"], (box1, box2, has_img, has_init))
            await spot(pg, "PG").click(); await settle(pg)
            ok("controls still open and work with initials showing", await pg.locator("section[aria-label='Controls for PG']").count() == 1)
            await pg.close()
        else:
            ok("photo fallback (no usable photo entry found to test with)", False, "manifest has no usable entries")

        # ---------- keyboard focus moves into controls and back; reduced motion ----------
        pg = await new_page(ctx); await goto(pg); await add_to(pg, "PG", "LeBron James")
        await spot(pg, "PG").focus(); await pg.keyboard.press("Enter"); await settle(pg)
        ok("opening an occupied spot moves focus into the controls", await pg.evaluate("document.activeElement?.getAttribute('aria-label')") == "Controls for PG")
        await pg.keyboard.press("Tab")
        ok("Tab then reaches the first control (season)", await pg.evaluate("document.activeElement?.tagName") == "SELECT")
        await pg.get_by_role("button", name="Change player", exact=True).click(); await settle(pg)
        ok("Change player focuses the search", await pg.evaluate("document.activeElement?.getAttribute('role')") == "combobox")
        await pg.get_by_role("button", name="Back", exact=True).click(); await settle(pg)
        ok("Back returns focus to the controls", await pg.evaluate("document.activeElement?.getAttribute('aria-label')") == "Controls for PG")
        await pg.get_by_role("button", name="Close", exact=True).click(); await settle(pg)
        ok("Close returns focus to the position", await pg.evaluate("document.activeElement?.dataset?.slot") == "PG" and await pg.locator("section[aria-label^='Controls']").count() == 0)
        await spot(pg, "PG").click(); await pg.get_by_role("button", name="Change player", exact=True).click(); await pick(pg, "Kevin Durant"); await settle(pg)
        ok("after replacing a player, focus returns to the position", await pg.evaluate("document.activeElement?.dataset?.slot") == "PG" and "Durant" in await stext(pg, "PG"))
        await pg.close()
        for reduce, want in [(True, "auto"), (False, "smooth")]:
            rctx = await new_context(b, viewport={"width": 390, "height": 844}, reduced_motion="reduce" if reduce else "no-preference")
            pg = await new_page(rctx)
            await pg.add_init_script("window.__siv=[];const o=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(a){window.__siv.push(a&&a.behavior);return o.call(this,a)}")
            await goto(pg); await add_to(pg, "PG", "LeBron James"); await spot(pg, "PG").click(); await settle(pg)
            calls = await pg.evaluate("window.__siv")
            ok(f"scrolling to the controls uses '{want}' when reduced motion is {'on' if reduce else 'off'}", want in calls and ("smooth" not in calls if reduce else True), calls)
            if reduce:
                await add_to(pg, "SG", "Kevin Durant") if False else None
                dur = await pg.evaluate("(()=>{const e=document.querySelector('[aria-busy]')||document.body;return getComputedStyle(document.querySelector('.bg-gradient-to-r')||e).transitionDuration})()")
                ok("reduced motion: score-bar animation is effectively off", dur in ("0.000001s", "1e-06s", "0s") or float(dur.replace("s", "").split(",")[0]) < 0.001, dur)
            await rctx.close()

        # ---------- touch / phone ----------
        mctx = await new_context(b, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = await new_page(mctx); pg.on("pageerror", lambda e: errs.append(str(e)))
        await goto(pg)
        for code, name in zip(CODES, NAMES):
            await spot(pg, code).tap(); await settle(pg)
            await pg.get_by_role("combobox").fill(SEARCH[name]); await settle(pg)
            await pg.get_by_role("option").filter(has_text=name).first.tap(); await settle(pg)
        ok("touch: all five positions filled by tapping", all([("empty" not in (await spot(pg, cc).get_attribute("aria-label"))) for cc in CODES]))
        base_m = await scores(pg)
        await pg.screenshot(path=f"{SHOTS}/phone-full.png", full_page=True)
        await spot(pg, "SF").tap(); await settle(pg)
        await pg.screenshot(path=f"{SHOTS}/phone-controls.png", full_page=True)
        await pg.get_by_role("button", name="Move", exact=True).tap(); await settle(pg)
        await pg.screenshot(path=f"{SHOTS}/phone-moving.png", full_page=True)
        await spot(pg, "PG").tap(); await settle(pg)
        ok("touch: move/swap works and scores unchanged", await scores(pg) == base_m)
        await spot(pg, "C").tap(); await pg.get_by_role("button", name="Remove", exact=True).tap(); await settle(pg)
        ok("touch: remove works", "empty" in (await spot(pg, "C").get_attribute("aria-label")))
        # overlap / overflow checks at several widths
        for w, h in [(360, 740), (390, 844), (768, 1024), (1300, 900)]:
            await pg.set_viewport_size({"width": w, "height": h}); await settle(pg)
            await add_to(pg, "C", "Nikola Jokić", "jokic") if await spot(pg, "C").get_attribute("aria-label") and "empty" in await spot(pg, "C").get_attribute("aria-label") else None
            boxes = [await spot(pg, cc).bounding_box() for cc in CODES]
            court = await pg.locator("button[data-slot=PG]").evaluate("e=>{const r=e.parentElement.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")
            overlap = any(not (a["x"] + a["width"] <= b2["x"] or b2["x"] + b2["width"] <= a["x"] or a["y"] + a["height"] <= b2["y"] or b2["y"] + b2["height"] <= a["y"]) for i, a in enumerate(boxes) for b2 in boxes[i + 1:])
            inside = all(bx["x"] >= court["x"] - 1 and bx["x"] + bx["width"] <= court["x"] + court["w"] + 1 and bx["y"] >= court["y"] - 1 and bx["y"] + bx["height"] <= court["y"] + court["h"] + 1 for bx in boxes)
            ovx = await pg.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth")
            ftop = await pg.evaluate("document.querySelector('footer').getBoundingClientRect().top+scrollY")
            cbottom = await pg.evaluate("(()=>{const e=document.querySelector('button[data-slot=PG]').parentElement.getBoundingClientRect();return e.bottom+scrollY})()")
            ok(f"{w}px: spots don't overlap, stay inside the court, no horizontal scroll, footer below the court", not overlap and inside and not ovx and ftop >= cbottom, (overlap, inside, ovx, ftop, cbottom))
            # move mode adds Moving/Swap tags: card sizes must not change and nothing may overlap
            await spot(pg, "SG").click(); await pg.get_by_role("button", name="Move", exact=True).click(); await settle(pg)
            boxes2 = [await spot(pg, cc).bounding_box() for cc in CODES]
            same_size = all(abs(a["width"] - c2["width"]) < 0.5 and abs(a["height"] - c2["height"]) < 0.5 for a, c2 in zip(boxes, boxes2))
            overlap2 = any(not (a["x"] + a["width"] <= b2["x"] or b2["x"] + b2["width"] <= a["x"] or a["y"] + a["height"] <= b2["y"] or b2["y"] + b2["height"] <= a["y"]) for i, a in enumerate(boxes2) for b2 in boxes2[i + 1:])
            ok(f"{w}px: in move mode the Moving/Swap tags don't change card sizes or cause overlap", same_size and not overlap2, (same_size, overlap2))
            await pg.keyboard.press("Escape"); await settle(pg)
        await pg.set_viewport_size({"width": 390, "height": 844}); await settle(pg)
        # open controls on phone: panel must not overlap court
        await spot(pg, "PG").tap(); await settle(pg)
        pb = await pg.locator("section[aria-label='Controls for PG']").bounding_box()
        cb = await spot(pg, "PG").evaluate("e=>{const r=e.parentElement.getBoundingClientRect();return {y:r.y+r.height}}")
        ok("phone: controls sit below the court, not over it", pb["y"] >= cb["y"] - 1, (pb, cb))
        await mctx.close()

        # ---------- shared autocomplete elsewhere ----------
        pg = await new_page(ctx)
        # Each call site now states its own pool: Discover and Compare open any display-eligible season (the latest,
        # small samples labelled); the Player Map keeps the stricter qualified pool.
        for path, q in [("/", "thybulle"), ("/galaxy?season=2026", "thybulle"), ("/compare", "thybulle")]:
            await pg.goto(B + path)
            inp = pg.get_by_role("combobox").first; await inp.wait_for(); await inp.click(); await inp.fill(q)
            await pg.get_by_role("option").first.wait_for()
            row = await pg.get_by_role("option").first.inner_text()
            if path.startswith("/galaxy"):
                ok("Player Map search keeps the qualified pool: resolves to 2023-24, no small-sample tag", "2023-24" in row and "Small sample" not in row, row)
            else:
                ok(f"search on {path} resolves to the latest season (2025-26) and labels the small sample", "2025-26" in row and "Small sample" in row, row)
            if path == "/":
                await pg.get_by_role("option").first.click(); await pg.wait_for_url("**/player/**")
                ok("home search opens the latest (small-sample) profile", pg.url.endswith(f"/player/{pid('Matisse Thybulle')}/2026"), pg.url)
        await pg.close()

        # ---------- navigation and footer ----------
        pg = await new_page(ctx)
        await pg.goto(B + "/"); await settle(pg)
        links = await pg.locator("nav[aria-label='Primary'] a").all_inner_texts()
        ok("desktop top menu has exactly the four links in order", links == ["Discover", "Player Map", "Compare Players", "Build a Lineup"], links)
        await pg.screenshot(path=f"{SHOTS}/desktop-home-nav-footer.png", full_page=False)
        hrefs = await pg.locator("nav[aria-label='Primary'] a").evaluate_all("els=>els.map(e=>e.getAttribute('href'))")
        ok("top menu hrefs", hrefs == ["/", "/galaxy", "/compare", "/build-a-five"], hrefs)
        pages = ["/", "/galaxy", "/compare", "/build-a-five", "/methodology", "/credits", f"/player/{pid('Matisse Thybulle')}/2024", f"/career/{pid('Matisse Thybulle')}"]
        for path in pages:
            r = await pg.goto(B + path); await settle(pg)
            foot = await pg.locator("footer nav[aria-label='Footer'] a").all_inner_texts()
            fb = await pg.evaluate("(()=>{const f=document.querySelector('footer').getBoundingClientRect();const m=document.querySelector('main').getBoundingClientRect();return {ft:f.top+scrollY,mb:m.bottom+scrollY}})()")
            ok(f"{path.split('/')[1] or 'home'}: loads (HTTP {r.status}), footer has How It Works + Credits, footer sits below the content", r.status == 200 and foot[:2] == ["How It Works", "Credits"] and fb["ft"] >= fb["mb"] - 1, (r.status, foot, fb))
        # active styles
        for path, label in [("/", "Discover"), ("/galaxy", "Player Map"), ("/compare", "Compare Players"), ("/build-a-five", "Build a Lineup")]:
            await pg.goto(B + path); await settle(pg)
            cur = await pg.locator("nav[aria-label='Primary'] a[aria-current=page]").all_inner_texts()
            ok(f"active nav link on {path}", cur == [label], cur)
        # every link works
        await pg.goto(B + "/"); 
        for label, href in [("Player Map", "/galaxy"), ("Compare Players", "/compare"), ("Build a Lineup", "/build-a-five"), ("Discover", "/")]:
            await pg.locator("nav[aria-label='Primary']").get_by_role("link", name=label, exact=True).click(); await settle(pg)
            ok(f"top link '{label}' navigates to {href}", pg.url == B + href, pg.url)
        for label, href in [("How It Works", "/methodology"), ("Credits", "/credits")]:
            await pg.locator("footer").get_by_role("link", name=label, exact=True).click(); await settle(pg)
            ok(f"footer link '{label}' navigates to {href}", pg.url == B + href, pg.url)
            ok(f"footer marks '{label}' as the current page", await pg.locator(f"footer a[aria-current=page]").all_inner_texts() == [label])
        # hover state on a nav link
        await pg.goto(B + "/"); l = pg.locator("nav[aria-label='Primary']").get_by_role("link", name="Player Map")
        b0 = await l.evaluate("e=>getComputedStyle(e).backgroundColor+'|'+getComputedStyle(e).color"); await l.hover(); await settle(pg)
        b1 = await l.evaluate("e=>getComputedStyle(e).backgroundColor+'|'+getComputedStyle(e).color")
        ok("nav links have a clear hover state", b0 != b1, (b0, b1))
        # keyboard access: tab through nav
        await pg.goto(B + "/"); await pg.keyboard.press("Tab")
        seen = []
        for _ in range(6):
            seen.append(await pg.evaluate("document.activeElement?.textContent?.trim()")); await pg.keyboard.press("Tab")
        ok("keyboard Tab reaches the four nav links in order", [x for x in seen if x in ("Discover", "Player Map", "Compare Players", "Build a Lineup")][:4] == ["Discover", "Player Map", "Compare Players", "Build a Lineup"], seen)
        await pg.close()
        # mobile nav
        mctx = await new_context(b, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        pg = await new_page(mctx); await pg.goto(B + "/build-a-five"); await settle(pg)
        ok("phone: inline desktop menu is hidden", not await pg.locator("nav[aria-label='Primary']").is_visible())
        await pg.get_by_role("button", name="Toggle navigation menu").tap(); await settle(pg)
        mlinks = await pg.locator("nav[aria-label='Primary mobile'] a").all_inner_texts()
        ok("phone menu has exactly the four links in order", mlinks == ["Discover", "Player Map", "Compare Players", "Build a Lineup"], mlinks)
        ok("phone menu marks the active page", await pg.locator("nav[aria-label='Primary mobile'] a[aria-current=page]").all_inner_texts() == ["Build a Lineup"])
        await pg.screenshot(path=f"{SHOTS}/phone-menu.png")
        await pg.keyboard.press("Escape"); await settle(pg)
        ok("phone menu closes with Escape", await pg.locator("nav[aria-label='Primary mobile']").count() == 0)
        await pg.get_by_role("button", name="Toggle navigation menu").tap(); await pg.locator("nav[aria-label='Primary mobile']").get_by_role("link", name="Player Map").tap(); await settle(pg)
        ok("phone menu link navigates", pg.url == B + "/galaxy", pg.url)
        await pg.goto(B + "/build-a-five"); await pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); await settle(pg)
        await pg.screenshot(path=f"{SHOTS}/phone-footer.png")
        await mctx.close()
        ok("no page errors during the run", not errs, errs)
        await b.close()
    print(f"\n{sum(res)} / {len(res)} passed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
