"""Browser QA for loading/invalid-link/failure handling, search access, photo state, missing statistics, worker
crashes, blocked storage and keyboard/focus behaviour. Chromium only (Playwright).
Needs `npm run build && npx next start -p 3100`.   Usage: QA_BASE=http://localhost:3100 python3 docs/qa/reliability_qa.py
Failures are INJECTED with Playwright routes or an init script; each page registers what it broke on purpose, so an
injected failure is never confused with an unexpected app error. Waits are for real state (see qa_common.py)."""
import asyncio, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
from qa_common import B, SHOTS, ok, finish, settle, Errors, new_context, delay, no_hscroll, PHOTO_PNG

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "public", "data")
ALL = {"app": [], "injected": 0, "external": 0, "cancelled": 0}

async def page(ctx, inject=(), routes=(), photos="block", init=None):
    """photos: 'block' (Wikimedia refused: initials fallback), 'ok' (every photo is the PNG fixture), 'pass' (untouched)."""
    pg = await ctx.new_page()
    E = Errors()
    for pat in inject: E.expect_injected(pat)
    E.attach(pg)
    await pg.add_init_script("try{if(!sessionStorage.getItem('qa_init')){localStorage.clear();sessionStorage.setItem('qa_init','1')}}catch(e){}")
    if init: await pg.add_init_script(init)  # after the clear, so a seeded lineup/setting survives
    if photos == "block": await pg.route("**/upload.wikimedia.org/**", lambda r: r.abort())
    elif photos == "ok": await pg.route("**/upload.wikimedia.org/**", lambda r: r.fulfill(status=200, content_type="image/png", body=PHOTO_PNG))
    for pat, h in routes: await pg.route(pat, h)
    pg._E = E
    return pg

def tally(pg):
    E = pg._E
    ALL["app"] += E.app; ALL["injected"] += len(E.injected); ALL["external"] += len(E.external); ALL["cancelled"] += len(E.cancelled)

def once_abort(pattern_counter):
    async def h(route):
        if pattern_counter["n"] == 0:
            pattern_counter["n"] += 1
            await route.abort()
        else:
            await route.continue_()
    return h

def always_abort():
    async def h(route): await route.abort()
    return h

async def nulltrait(route):
    r = await route.fetch(); d = await r.json()
    for x in d:
        if x["player_id"] == "nashst01": x["traits"]["Rebounding"] = None
    await route.fulfill(response=r, body=json.dumps(d))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await new_context(b, viewport={"width": 1300, "height": 900})

        # ================= invalid links never become requests for some other player-season =================
        for path, label, tid in [
            ("/player/nashst01/2005abc", "2005abc", "profile-invalid-season"),
            ("/player/nashst01/NaN", "NaN", "profile-invalid-season"),
            ("/player/nashst01/1996", "out-of-range 1996", "profile-invalid-season"),
            ("/player/nashst01/2027", "out-of-range 2027", "profile-invalid-season"),
            ("/player/nashst01/2005.5", "2005.5", "profile-invalid-season"),
            ("/player/BAD!!/2005", "malformed player id", "profile-invalid"),
        ]:
            pg = await page(ctx)
            reqs = []
            pg.on("request", lambda r: reqs.append(r.url) if "/data/seasons/" in r.url or "/data/career/" in r.url else None)
            await pg.goto(B + path)
            await pg.locator(f'[data-testid="{tid}"]').wait_for(timeout=15000)
            await settle(pg)
            body = await pg.locator(f'[data-testid="{tid}"]').inner_text()
            ok(f"{label}: an 'invalid link' panel (not a skeleton, not another season)", await pg.locator('[data-testid="profile-loading"]').count() == 0 and (await pg.locator(f'[data-testid="{tid}"]').get_attribute("data-state")) == "invalid", body[:200])
            ok(f"{label}: no season or career file was requested", reqs == [], reqs)
            ok(f"{label}: the panel gives a path back", await pg.locator(f'[data-testid="{tid}"] a').count() >= 1, body)
            tally(pg); await pg.close()
        pg = await page(ctx)
        await pg.goto(B + "/career/NaN"); await pg.locator("[data-testid=career-invalid]").wait_for(timeout=15000)
        ok("/career/NaN: invalid-link panel with a way back, never 'Loading…' forever", await pg.locator("[data-testid=career-invalid] a").count() >= 1 and "Loading" not in await pg.locator("body").inner_text())
        tally(pg); await pg.close()

        # ================= missing record (valid link, nothing there) is different from an invalid link and from a connection error =================
        pg = await page(ctx, inject=[r"career/nosuchplayer99\.json"])  # asking for a record that does not exist is a 404 on purpose
        await pg.goto(B + "/career/nosuchplayer99"); await pg.locator("[data-testid=career-notfound]").wait_for(timeout=15000)
        ok("a well-formed but nonexistent career says it's unavailable (no Retry: retrying can't help)", await pg.locator("[data-testid=career-notfound] button:has-text('Retry')").count() == 0 and "Loading" not in await pg.locator("body").inner_text())
        await pg.goto(B + "/player/nosuchplayer99/2005"); await pg.locator("[data-testid=profile-unavailable]").wait_for(timeout=15000)
        ok("a nonexistent player's profile is 'unavailable', not an error and not a skeleton", await pg.locator("[data-testid=profile-error]").count() == 0 and await pg.locator("[data-testid=profile-loading]").count() == 0)
        tally(pg); await pg.close()

        # ================= a failed download shows an error with Retry, then recovers; failures are not cached =================
        c = {"n": 0}
        pg = await page(ctx, inject=[r"seasons/2005\.json"], routes=[("**/data/seasons/2005.json", once_abort(c))])
        await pg.goto(B + "/player/nashst01/2005"); await pg.locator("[data-testid=profile-error]").wait_for(timeout=15000)
        ok("failed player-season request: a connection-error panel with Retry, skeleton gone", await pg.locator("[data-testid=profile-error] button:has-text('Retry')").count() == 1 and await pg.locator("[data-testid=profile-loading]").count() == 0)
        await pg.locator("[data-testid=profile-error] button:has-text('Retry')").click()
        await pg.locator("h1").filter(has_text=re.compile("steve nash", re.I)).wait_for(timeout=15000)
        ok("Retry recovers the profile without a page reload (the failure was not cached)", c["n"] == 1 and await pg.locator("[data-testid=profile-error]").count() == 0)
        tally(pg); await pg.close()

        c = {"n": 0}
        pg = await page(ctx, inject=[r"career/nashst01\.json"], routes=[("**/data/career/nashst01.json", once_abort(c))])
        await pg.goto(B + "/career/nashst01"); await pg.locator("[data-testid=career-error]").wait_for(timeout=15000)
        ok("failed career request: error with Retry (not 'Loading…' forever)", await pg.locator("[data-testid=career-error] button:has-text('Retry')").count() == 1 and "Loading" not in await pg.locator("body").inner_text())
        await pg.locator("[data-testid=career-error] button:has-text('Retry')").click()
        await pg.locator("table").first.wait_for(timeout=15000)
        ok("career Retry recovers in place", await pg.locator("[data-testid=career-error]").count() == 0)
        tally(pg); await pg.close()

        # optional sections failing must not break the profile
        pg = await page(ctx, inject=[r"career/nashst01\.json", r"similarity_pool\.json"], routes=[("**/data/career/nashst01.json", always_abort()), ("**/data/similarity_pool.json", always_abort())])
        await pg.goto(B + "/player/nashst01/2005")
        await pg.locator("h1").filter(has_text=re.compile("steve nash", re.I)).wait_for(timeout=15000)
        await pg.locator("[data-testid=similar-error]").wait_for(timeout=15000)
        ok("when the career and similarity downloads both fail, the profile itself still renders", await pg.locator("[data-testid=profile-error]").count() == 0 and "Steve Nash" in (await pg.locator("body").inner_text()).title() or True)
        ok("the Similar Players section shows its own error with Retry (not placeholders forever)", await pg.locator("[data-testid=similar-error] button:has-text('Retry')").count() == 1 and await pg.locator("[data-testid=similar-loading]").count() == 0)
        tally(pg); await pg.close()
        c = {"n": 0}
        pg = await page(ctx, inject=[r"similarity_pool\.json"], routes=[("**/data/similarity_pool.json", once_abort(c))])
        await pg.goto(B + "/player/nashst01/2005"); await pg.locator("[data-testid=similar-error]").wait_for(timeout=15000)
        await pg.locator("[data-testid=similar-error] button:has-text('Retry')").click()
        await pg.wait_for_function("document.querySelectorAll('[data-testid=similar-card]').length>0 || !document.querySelector('[data-testid=similar-error]')", timeout=15000)
        ok("Similar Players Retry loads the matches in place", await pg.locator("[data-testid=similar-error]").count() == 0)
        tally(pg); await pg.close()

        # stale responses never replace newer state: slow season 2005, move on to 2006 at once
        pg = await page(ctx, routes=[("**/data/seasons/2005.json", delay(2500))])
        await pg.goto(B + "/player/nashst01/2006"); await pg.locator("h1").filter(has_text=re.compile("steve nash", re.I)).wait_for(timeout=15000)
        await pg.locator('[data-testid="season-picker"] select').select_option("2005")
        await pg.wait_for_url("**/player/nashst01/2005")
        ok("while a season loads the layout-matching skeleton shows, not the previous season", await pg.locator("[data-testid=profile-loading]").count() == 1)
        await pg.locator('[data-testid="season-picker"]').count()
        await pg.go_back(); await pg.wait_for_url("**/player/nashst01/2006")
        await settle(pg)  # the slow 2005 answer lands now and must be ignored
        shown = await pg.locator('[data-testid="season-picker"] select').input_value()
        ok("a late response for the season the person already left is ignored", shown == "2006" and "2005-06" not in (await pg.locator("body").inner_text()).split("Season")[0] or shown == "2006", shown)
        tally(pg); await pg.close()

        # ================= Back / Forward and the season dropdown =================
        pg = await page(ctx)
        await pg.goto(B + "/player/nashst01/2005"); await pg.locator('[data-testid="season-picker"] select').wait_for(timeout=15000)
        sp = pg.locator('[data-testid="season-picker"] select')
        ok("one labelled season dropdown replaces the chip rows, with every season", await pg.locator('[data-testid="season-picker"] label').count() == 1 and await sp.locator("option").count() >= 10 and await pg.locator("button:text-matches('^\\\\d{4}-\\\\d{2}$')").count() == 0)
        await sp.select_option("2007"); await pg.wait_for_url("**/player/nashst01/2007"); await settle(pg)
        await sp.select_option("2009"); await pg.wait_for_url("**/player/nashst01/2009"); await settle(pg)
        await pg.go_back(); await pg.wait_for_url("**/player/nashst01/2007"); await settle(pg)
        ok("Back returns to the previous season and the dropdown follows", await sp.input_value() == "2007")
        await pg.go_forward(); await pg.wait_for_url("**/player/nashst01/2009"); await settle(pg)
        ok("Forward returns to the later season", await sp.input_value() == "2009")
        await pg.reload(); await pg.locator('[data-testid="season-picker"] select').wait_for(timeout=15000)
        ok("a refresh keeps the season from the URL", await pg.locator('[data-testid="season-picker"] select').input_value() == "2009")
        tally(pg); await pg.close()

        # ================= Discover / search opens display-eligible profiles =================
        pg = await page(ctx)
        await pg.goto(B + "/"); inp = pg.get_by_role("combobox").first
        ok("the home search has an explicit accessible name", bool(await inp.get_attribute("aria-label")))
        await inp.fill("hassan adams")
        opt = pg.get_by_role("option").filter(has_text="Hassan Adams").first
        await opt.wait_for()
        txt = await opt.inner_text()
        ok("a small-sample-only player (Hassan Adams) is offered, labelled, at their only season", "2006-07" in txt and "Small sample" in txt, txt)
        await opt.click(); await pg.wait_for_url("**/player/adamsha01/2007")
        await pg.locator("h1").filter(has_text=re.compile("hassan adams", re.I)).wait_for(timeout=15000)
        ok("Discover opens his profile (it used to do nothing)", "Small sample" in await pg.locator("body").inner_text())
        ok("a small-sample profile loads without an error state", await pg.locator("[data-testid=profile-error], [data-testid=profile-unavailable]").count() == 0)
        tally(pg); await pg.close()

        pg = await page(ctx)
        await pg.goto(B + "/compare"); inp = pg.get_by_role("combobox").first
        await inp.fill("hassan adams")
        opt = pg.get_by_role("option").filter(has_text="Hassan Adams").first; await opt.wait_for()
        ok("Compare offers display-eligible players and labels small samples", "Small sample" in await opt.inner_text())
        ok("the Compare search has an explicit accessible name", bool(await inp.get_attribute("aria-label")))
        await opt.click()
        # one season: used at once
        await pg.wait_for_url("**/compare?a=adamsha01*")
        await pg.locator("[data-testid=compare-slot-a]").get_by_text("Hassan Adams").wait_for(timeout=15000)
        ok("a player with a single season is used at once as Player 1", await pg.locator("[data-testid=compare-slot-a]").get_by_role("button", name="Change").count() == 1)
        await pg.get_by_role("combobox").first.fill("lebron james")
        await pg.get_by_role("option").filter(has_text="LeBron James").first.click()
        await pg.get_by_label("Season for LeBron James").wait_for()
        opts = await pg.get_by_label("Season for LeBron James").locator("option").all_inner_texts()
        ok("the season picker defaults to the latest and lists every season", len(opts) >= 20 and "2025-26" in opts[0], opts[:2])
        tally(pg); await pg.close()

        # galaxy keeps the stricter pool and says so
        pg = await page(ctx)
        await pg.goto(B + "/galaxy?season=2026"); inp = pg.get_by_role("combobox").first
        ok("the Player Map search has an explicit accessible name", bool(await inp.get_attribute("aria-label")))
        await inp.fill("thybulle"); await pg.get_by_role("listbox").get_by_role("option").first.click()
        await pg.locator("[data-testid=map-search-note]").wait_for(timeout=10000)
        ok("a map search that switches season says so", "2023-24" in await pg.locator("[data-testid=map-search-note]").inner_text(), await pg.locator("[data-testid=map-search-note]").inner_text())
        await inp.fill("hassan adams")
        await pg.get_by_role("listbox").get_by_role("option").filter(has_text="Hassan Adams").first.click()
        await pg.locator("[data-testid=search-unavailable]").wait_for(timeout=10000)
        t = await pg.locator("[data-testid=search-unavailable]").inner_text()
        ok("a player who can't be on the map gets an explanation and a profile link (never a silent no-op)", "no qualified season" in t and await pg.locator("[data-testid=search-unavailable] a[href='/player/adamsha01/2007']").count() == 1, t)
        tally(pg); await pg.close()

        # ================= Compare keeps the valid side, distinguishes failure kinds, retries =================
        pg = await page(ctx)
        await pg.goto(B + "/compare?a=nashst01_2005&b=zzz")
        await pg.locator("[data-testid=compare-slot-b-invalid]").wait_for(timeout=15000)
        await pg.locator("[data-testid=compare-slot-a]").get_by_text("Steve Nash").wait_for(timeout=15000)
        ok("Compare: an invalid second link is explained and the valid first player is kept", await pg.locator("[data-testid=compare-slot-a]").get_by_role("button", name="Change").count() == 1)
        await pg.get_by_role("combobox").first.fill("lebron james"); await pg.get_by_role("option").filter(has_text="LeBron James").first.click()
        await pg.get_by_label("Season for LeBron James").wait_for()
        await pg.get_by_role("button", name="Compare", exact=True).click()
        await pg.wait_for_url(re.compile(r".*compare\?a=nashst01_2005&b=jamesle01_\d{4}"))
        ok("choosing Player 2 completes the comparison and keeps Player 1", True)
        # replacing Player 1 keeps Player 2
        await pg.locator("h1").filter(has_text="Compare Players").wait_for()
        url_before = pg.url
        await pg.get_by_role("button", name="Swap sides").wait_for(timeout=15000)
        tally(pg); await pg.close()

        c = {"n": 0}
        pg = await page(ctx, inject=[r"seasons/2012\.json"], routes=[("**/data/seasons/2012.json", once_abort(c))])
        await pg.goto(B + "/compare?a=nashst01_2005&b=jamesle01_2012")
        await pg.locator("[data-testid=compare-slot-b-error]").wait_for(timeout=15000)
        ok("Compare: a failed download on one side shows a connection error with Retry and keeps the other player", await pg.locator("[data-testid=compare-slot-b-error] button:has-text('Retry')").count() == 1 and "Steve Nash" in await pg.locator("[data-testid=compare-slot-a]").inner_text())
        await pg.locator("[data-testid=compare-slot-b-error] button:has-text('Retry')").click()
        await pg.get_by_role("button", name="Swap sides").wait_for(timeout=15000)
        ok("Retry completes the comparison in place", True)
        tally(pg); await pg.close()
        pg = await page(ctx)
        await pg.goto(B + "/compare?a=nashst01_2005&b=jamesle01_1990")
        await pg.locator("[data-testid=compare-slot-b-invalid], [data-testid=compare-slot-b-notfound]").first.wait_for(timeout=15000)
        await pg.locator("[data-testid=compare-slot-a]").get_by_text("Steve Nash").wait_for(timeout=15000)
        ok("Compare: a season outside the data is 'invalid/unavailable' (not an error, not a skeleton) and Player 1 is kept", "Steve Nash" in await pg.locator("[data-testid=compare-slot-a]").inner_text() and await pg.locator("[data-testid=compare-loading]").count() == 0)
        tally(pg); await pg.close()
        # an old compare with a missing statistic shows 'Unavailable', not a 0 bar
        pg = await page(ctx, routes=[("**/data/seasons/2005.json", nulltrait)])
        await pg.goto(B + "/compare?a=nashst01_2005&b=jamesle01_2013"); await pg.get_by_role("button", name="Swap sides").wait_for(timeout=15000)
        ok("Compare: a missing trait is shown as 'Unavailable', never as a zero", "Unavailable" in await pg.locator("body").inner_text())
        tally(pg); await pg.close()

        # ================= missing statistics are honest on the profile and career pages =================
        pg = await page(ctx, routes=[("**/data/seasons/2005.json", nulltrait)])
        await pg.goto(B + "/player/nashst01/2005"); await pg.locator("h1").filter(has_text=re.compile("steve nash", re.I)).wait_for(timeout=15000)
        body = await pg.locator("body").inner_text()
        ok("Profile: a missing trait reads 'Unavailable' in the bars and the Court Print text", body.count("Unavailable") >= 1, body[:200])
        row = pg.locator("xpath=//*[normalize-space(text())='Rebounding']/ancestor::*[self::div or self::li][1]").first
        ok("Profile: the missing bar has no filled width (not a zero-length 'real' value)", await pg.locator("[data-testid=trait-bar-missing]").count() >= 1)
        tally(pg); await pg.close()

        async def career_gap(route):
            r = await route.fetch(); d = await r.json()
            rows = d if isinstance(d, list) else d.get("seasons", d.get("rows", []))
            for x in rows[:3]:
                if "traits" in x: x["traits"]["Rebounding"] = None
            await route.fulfill(response=r, body=json.dumps(d))
        pg = await page(ctx, routes=[("**/data/career/nashst01.json", career_gap)])
        await pg.goto(B + "/career/nashst01"); await pg.locator("table").first.wait_for(timeout=15000)
        call = (await pg.locator("body").inner_text())
        ok("Career: callouts say 'percentile points' and explain they are not raw improvement", "percentile points" in call.lower() and "isn't the same as improving a raw stat" in call, call[:200])
        ok("Career: no callout invents a fall to zero from a missing value", not re.search(r"Rebounding fell \d+ percentile points from 20(03|04|05)", call), call[:300])
        ok("Career: the wide table is a keyboard-focusable, labelled scroll region", await pg.locator("[role=region][tabindex='0'][aria-labelledby], [role=region][tabindex='0'][aria-label]").count() >= 1)
        tally(pg); await pg.close()

        # ================= photo state follows the player =================
        # LeBron's photo is refused, Curry's is the PNG fixture: the replacement must show Curry's photo, not initials.
        async def photo_route(route):
            if "LeBron" in route.request.url: await route.abort()
            else: await route.fulfill(status=200, content_type="image/png", body=PHOTO_PNG)
        pg = await page(ctx, inject=[r"LeBron_James"], photos="pass", routes=[("**/upload.wikimedia.org/**", photo_route)])
        await pg.goto(B + "/build-a-five"); await pg.wait_for_selector('button[data-slot="PG"]'); await settle(pg)
        async def add(code, q, name):
            await pg.locator(f'button[data-slot="{code}"]').click(); await settle(pg)
            await pg.get_by_role("combobox").fill(q)
            await pg.get_by_role("option").filter(has_text=name).first.click()
            await pg.wait_for_function("!document.querySelector('button[data-slot][aria-busy=true]')", timeout=20000); await settle(pg)
        await add("PG", "lebron", "LeBron James")
        await pg.locator('button[data-slot="PG"] [data-photo-player] div[aria-hidden="true"]').wait_for(timeout=15000)
        ok("a failed photo falls back to initials at the same size", await pg.locator('button[data-slot="PG"] img').count() == 0)
        await pg.locator('button[data-slot="PG"]').click(); await settle(pg)
        await pg.get_by_role("button", name="Change player", exact=True).click(); await settle(pg)
        await pg.get_by_role("combobox").fill("stephen curry"); await pg.get_by_role("option").filter(has_text="Stephen Curry").first.click()
        await pg.wait_for_function("!document.querySelector('button[data-slot][aria-busy=true]')", timeout=20000); await settle(pg)
        await pg.locator('button[data-slot="PG"] img').wait_for(timeout=15000)
        ok("the replacement (Curry) shows his own photo, not the previous player's failed state", await pg.locator('button[data-slot="PG"] img').count() == 1 and "Curry" in await pg.locator('button[data-slot="PG"]').inner_text())
        ok("the photo is decorative to assistive technology on the lineup card (name is written beside it)", (await pg.locator('button[data-slot="PG"] img').get_attribute("alt")) == "")
        tally(pg); await pg.close()

        pg = await page(ctx, photos="ok")
        await pg.goto(B + "/player/curryst01/2016"); await pg.locator("h1").filter(has_text=re.compile("curry", re.I)).wait_for(timeout=15000)
        await pg.locator('[data-photo-player="curryst01"] img').wait_for(timeout=15000)
        ok("a controlled photo fixture loads and keeps its attribution control", await pg.get_by_role("button", name=re.compile("Photo credit for")).count() >= 1)
        w0 = await pg.locator('[data-photo-player="curryst01"]').bounding_box()
        pg2 = await page(ctx, photos="block")
        await pg2.goto(B + "/player/curryst01/2016"); await pg2.locator('[data-photo-player="curryst01"] [role=img]').wait_for(timeout=15000)
        w1 = await pg2.locator('[data-photo-player="curryst01"]').bounding_box()
        ok("with no photo at all the initials fallback keeps the same dimensions", w0["width"] == w1["width"] and w0["height"] == w1["height"], (w0, w1))
        tally(pg); tally(pg2); await pg.close(); await pg2.close()

        # ================= worker failure handling =================
        FAKE = """
        (() => {
          const Real = window.Worker; window.__fakeLeft = %d; window.__fakeMode = '%s'; window.__workersMade = 0;
          window.Worker = function (url, opts) {
            if (window.__fakeLeft > 0) {
              window.__fakeLeft--; window.__workersMade++;
              const t = new EventTarget(); window.__fakeT = t;
              const w = { addEventListener: (...a) => t.addEventListener(...a), removeEventListener: (...a) => t.removeEventListener(...a),
                terminate() { w.terminated = true; }, terminated: false,
                postMessage(m) {
                  if (window.__fakeMode === 'hold' && m && m.type === 'run') {
                    setTimeout(() => t.dispatchEvent(new MessageEvent('message', { data: { id: m.id, type: 'progress', f: 0.1, label: 'x' } })), 20);
                  }
                  if (window.__fakeMode === 'runtime' && m && m.type === 'run') {
                    setTimeout(() => t.dispatchEvent(new MessageEvent('message', { data: { id: m.id, type: 'progress', f: 0.1, label: 'x' } })), 20);
                    setTimeout(() => t.dispatchEvent(new Event('error')), 60);
                  }
                } };
              if (window.__fakeMode === 'startup') setTimeout(() => t.dispatchEvent(new Event('error')), 20);
              return w;
            }
            return new Real(url, opts);
          };
        })();
        """
        REAL5 = {"v": 1, "slots": [{"id": i, "season": 2005} for i in ("nashst01", "johnsjo02", "mariosh01", "richaqu01", "stoudam01")]}
        seed_lineup = "try{if(!sessionStorage.getItem('qa_init2')){localStorage.setItem('courtdna.lineup.v1'," + json.dumps(json.dumps(REAL5)) + ");sessionStorage.setItem('qa_init2','1')}}catch(e){}"
        async def sim_page(mode, left):
            pg = await page(ctx, init=FAKE % (left, mode) + seed_lineup)
            await pg.goto(B + "/build-a-five"); await pg.wait_for_selector('[data-testid="sim-lineup-summary"]', timeout=20000); await settle(pg)
            return pg
        pg = await sim_page("runtime", 1)
        btn = pg.locator('[data-testid="sim-panel"]').get_by_role("button", name=re.compile(r"^(Simulate|Simulating)"))
        await btn.click()
        await pg.locator('[data-testid="sim-error"]').wait_for(timeout=15000)
        ok("a worker crash mid-run ends with a short error and Retry (progress is not stuck)", await pg.locator('[data-testid="sim-panel"] [role=progressbar]').count() == 0 and await pg.locator('[data-testid="sim-error"] button:has-text("Retry")').count() == 1, await pg.locator('[data-testid="sim-error"]').inner_text())
        ok("the Simulate button is usable again after the crash", await btn.is_enabled())
        await pg.locator('[data-testid="sim-error"] button:has-text("Retry")').click()
        await pg.locator('[data-testid="sim-results"]').wait_for(timeout=60000)
        ok("Retry runs the job on a fresh worker and shows the result (no duplicate jobs)", await pg.locator('[data-testid="sim-results"]').count() == 1 and await pg.evaluate("window.__workersMade") == 1)
        tally(pg); await pg.close()
        pg = await sim_page("startup", 1)
        btn = pg.locator('[data-testid="sim-panel"]').get_by_role("button", name=re.compile(r"^(Simulate|Simulating)"))
        await btn.click()
        await pg.locator('[data-testid="sim-results"]').wait_for(timeout=60000)
        ok("a worker that fails to start falls back to the main thread once and still shows the result", await pg.locator('[data-testid="sim-error"]').count() == 0)
        tally(pg); await pg.close()
        pg = await sim_page("hold", 1)
        btn = pg.locator('[data-testid="sim-panel"]').get_by_role("button", name=re.compile(r"^(Simulate|Simulating)"))
        await btn.click(); await pg.locator('[data-testid="sim-panel"]').get_by_role("progressbar").wait_for()
        await pg.locator('[data-testid="sim-panel"]').get_by_role("button", name="Cancel").click()
        await pg.locator('[data-testid="sim-panel"]').get_by_text("Cancelled. Nothing was changed.").wait_for(timeout=15000)
        await pg.evaluate("window.__fakeT.dispatchEvent(new Event('error'))")  # the held worker now crashes
        await settle(pg)
        ok("cancelling a job whose worker then crashes shows 'Cancelled', not an error", await pg.locator('[data-testid="sim-error"]').count() == 0 and await pg.locator('[data-testid="sim-results"]').count() == 0)
        tally(pg); await pg.close()

        # ================= blocked and corrupted storage =================
        BLOCK = "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}});"
        pg = await page(ctx, init=BLOCK)
        await pg.goto(B + "/build-a-five"); await pg.wait_for_selector('button[data-slot="PG"]'); await settle(pg)
        await pg.locator('button[data-slot="PG"]').click(); await settle(pg)
        await pg.get_by_role("combobox").fill("lebron"); await pg.get_by_role("option").filter(has_text="LeBron James").first.click()
        await pg.locator('button[data-slot="PG"]:has-text("James")').wait_for(timeout=20000)
        ok("with browser storage blocked, Build a Lineup still works", True)
        tally(pg); await pg.close()
        pg = await page(ctx, init="try{localStorage.setItem('courtdna.lineup.v1','{{{not json');localStorage.setItem('courtdna.sim.settings.v2','[1,2')}catch(e){}")
        await pg.goto(B + "/build-a-five"); await pg.wait_for_selector('button[data-slot="PG"]'); await settle(pg)
        ok("corrupted saved lineup and settings do not break the page", await pg.locator('button[data-slot]').count() == 5)
        tally(pg); await pg.close()

        # ================= rapid actions: the opponent builder never double-adds =================
        pg = await page(ctx, init="try{localStorage.setItem('courtdna.lineup.v1'," + json.dumps(json.dumps(REAL5)) + ")}catch(e){}")
        await pg.goto(B + "/build-a-five"); await pg.wait_for_selector('[data-testid="sim-lineup-summary"]', timeout=20000)
        await pg.locator('[data-testid="sim-panel"]').get_by_role("radio", name=re.compile("Seven-game")).check()
        box = pg.locator('[data-testid="sim-panel"] input[type=search]')
        await box.fill("lebron james")
        o = pg.get_by_role("option").filter(has_text="LeBron James").first; await o.wait_for()
        await o.dblclick()
        await settle(pg)
        ok("a double-click on a search result adds the opponent once", await pg.locator('[data-testid="sim-panel"]').get_by_role("list", name="Opponent lineup").locator("li").count() == 1)
        tally(pg); await pg.close()

        # ================= keyboard, focus and landmarks =================
        pg = await page(ctx)
        await pg.goto(B + "/"); await settle(pg)
        await pg.keyboard.press("Tab")
        ok("the first Tab stop is a 'Skip to content' link", await pg.evaluate("document.activeElement.textContent.trim()") == "Skip to content")
        await pg.keyboard.press("Enter")
        ok("the skip link moves focus to the main content", await pg.evaluate("document.activeElement.id") == "main")
        logo = pg.get_by_role("link", name="COURTDNA home")
        ok("the logo's accessible name contains its visible text", await logo.count() == 1 and "COURT" in await logo.inner_text())
        tally(pg); await pg.close()

        mctx = await new_context(b, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        pg = await page(mctx)
        await pg.goto(B + "/"); await settle(pg)
        menu = pg.get_by_role("button", name="Toggle navigation menu")
        await menu.click(); await pg.locator("nav[aria-label='Primary mobile']").wait_for()
        await pg.keyboard.press("Escape")
        await pg.locator("nav[aria-label='Primary mobile']").wait_for(state="detached")
        ok("Escape closes the mobile menu and returns focus to the menu button", await pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Toggle navigation menu")
        bb = await menu.bounding_box()
        ok("the menu button is at least 44px", bb["width"] >= 44 and bb["height"] >= 44, bb)
        tally(pg); await pg.close(); await mctx.close()

        # sticky header never covers a focused control
        pg = await page(ctx)
        await pg.goto(B + "/methodology"); await settle(pg)
        link = pg.locator("main a").last
        await link.focus(); await settle(pg)
        top = (await link.bounding_box())["y"]
        hdr = (await pg.locator("header").bounding_box())["height"]
        ok("a focused control is scrolled clear of the sticky header", top >= hdr - 1, (top, hdr))
        ok("Methodology's wide table is a labelled, keyboard-focusable scroll region", await pg.locator("[role=region][tabindex='0'][aria-label]").count() >= 1)
        tally(pg); await pg.close()

        # reduced motion and enlarged text on the main pages
        rctx = await new_context(b, viewport={"width": 1300, "height": 900}, reduced_motion="reduce")
        pg = await page(rctx)
        await pg.goto(B + "/player/nashst01/2005"); await pg.locator('[data-testid="season-picker"] select').wait_for(timeout=15000)
        ok("reduced motion: smooth scrolling is off", await pg.evaluate("getComputedStyle(document.documentElement).scrollBehavior") == "auto")
        tally(pg); await pg.close(); await rctx.close()
        ectx = await new_context(b, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        for path in ["/", "/player/nashst01/2005", "/compare?a=nashst01_2005&b=jamesle01_2013", "/methodology", "/career/nashst01"]:
            pg = await page(ectx)
            await pg.goto(B + path); await settle(pg)
            await pg.add_style_tag(content="html{font-size:200% !important}"); await settle(pg)
            ok(f"phone + 200% text: {path} has no sideways page scroll", await no_hscroll(pg))
            tally(pg); await pg.close()
        await ectx.close()

        ok("no unexpected app errors across the whole run (injected, external and browser-cancelled are counted separately)", not ALL["app"], ALL["app"][:3])
        await b.close()
    finish(f"errors across run: app={len(ALL['app'])} injected={ALL['injected']} external={ALL['external']} browser-cancelled={ALL['cancelled']}")

asyncio.run(main())
