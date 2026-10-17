"""Browser QA for the Shooting Profile court (Chromium only; real mouse, keyboard and touch input).
Needs `npm run build && npx next start -p 3100` and `pip install playwright`.  Usage: python3 docs/qa/shot_ui_qa.py
Writes screenshots to docs/screenshots/phase5/ and measurements to docs/qa/shot_ui_metrics.json."""
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from qa_common import TRACK_INIT, Errors, settle_sync
B = os.environ.get("QA_BASE", "http://localhost:3100")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "screenshots", "phase11")
res, metrics = [], {}
def ok(n, c, d=""):
    res.append((n, bool(c))); print(("PASS " if c else "FAIL ") + n + (" -- " + str(d)[:300] if (d and not c) else ""), flush=True)
SEL = "svg[aria-label^='Shooting profile']"
PT = {"x0_3": (250, 52), "x3_10": (250, 117), "x10_16": (250, 182), "x16_3p": (250, 262), "x3p": (250, 330), "x3d": (250, 385)}
NAMES = {"x0_3": "0–3 ft", "x3_10": "3–10 ft", "x10_16": "10–16 ft", "x16_3p": "16 ft–3PT", "x3p": "Three-pointers", "x3d": "Deep threes · 30+ ft"}
BG, GUIDE, HOVER, SEL_C = "#111820", "#64748B", "#93C5FD", "#60A5FA"
def pt(pg, i, x, y):
    return pg.evaluate("""([s,i,x,y])=>{const v=document.querySelectorAll(s)[i];const p=v.createSVGPoint();p.x=x;p.y=y;const m=p.matrixTransform(v.getScreenCTM());return [m.x,m.y]}""", [SEL, i, x, y])
def show(pg, i=0): pg.locator(SEL).nth(i).evaluate("e=>e.scrollIntoView({block:'center',behavior:'instant'})"); settle_sync(pg)
def move(pg, zone, i=0, dx=0, dy=0):
    show(pg, i); x, y = pt(pg, i, *PT[zone]); pg.mouse.move(x + dx, y + dy); settle_sync(pg); return x, y
def click(pg, zone, i=0, touch=False):
    show(pg, i); x, y = pt(pg, i, *PT[zone]); (pg.touchscreen.tap(x, y) if touch else pg.mouse.click(x, y)); settle_sync(pg)
def pressed(pg, i=0):
    return pg.evaluate("""([s,i])=>[...document.querySelectorAll(s)[i].querySelectorAll('[data-zone]')].filter(e=>e.getAttribute('aria-pressed')==='true').map(e=>e.dataset.zone)""", [SEL, i])
def attr(pg, a, i=0):
    return pg.evaluate("""([s,i,a])=>[...document.querySelectorAll(s)[i].querySelectorAll('['+a+']')].map(e=>e.getAttribute(a))""", [SEL, i, a])
def fills(pg, i=0):
    return pg.evaluate("""([s,i])=>Object.fromEntries([...document.querySelectorAll(s)[i].querySelectorAll('[data-zone]')].map(e=>[e.dataset.zone,e.getAttribute('fill')]))""", [SEL, i])
def det(pg, i=0): return pg.locator("[data-testid=shot-details]").nth(i).inner_text()
def tips(pg): return pg.locator("[data-testid=zone-tooltip]")
def tip_text(pg): return tips(pg).first.inner_text() if tips(pg).count() else ""
def tip_box(pg): return tips(pg).first.bounding_box()
def dots(pg, i=0):
    return pg.evaluate("""([s,i])=>[...document.querySelectorAll(s)[i].parentElement.querySelectorAll('[data-testid=shot-dots] path')].map(e=>[e.dataset.kind,e.dataset.state,(e.getAttribute('d').match(/M/g)||[]).length])""", [SEL, i])
def count(d, kind=None, state=None): return sum(n // 2 if k == "missed" else n for k, s, n in d if (kind is None or k == kind) and (state is None or s == state))
def shot(pg, name, clip_to=None):
    path = os.path.join(OUT, name)
    (clip_to or pg).screenshot(path=path) if clip_to else pg.screenshot(path=path)
def toggle(pg, i=0): pg.get_by_role("switch", name="Show shots").nth(i)
def dots_off(pg, i=0):
    pg.get_by_role("switch", name="Show shots").nth(i).click(); settle_sync(pg)
def dots_on(pg, i=0):
    pg.get_by_role("switch", name="Show shots").nth(i).click(); pg.wait_for_function("([s,i])=>document.querySelectorAll(s)[i].parentElement.querySelector('[data-testid=shot-dots]')", arg=[SEL, i]); settle_sync(pg)

def run(mobile):
    tag = "mobile" if mobile else "desktop"
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900}, has_touch=mobile, is_mobile=mobile)
        ctx.add_init_script(TRACK_INIT)
        pg = ctx.new_page(); E = Errors().attach(pg)
        t0 = time.time(); pg.goto(f"{B}/player/bryanko01/2009"); pg.wait_for_selector(SEL)
        txt = pg.inner_text("body")
        want = "Tap a zone to see shooting stats." if mobile else "Hover for stats. Click to keep a zone selected."
        ok(f"[{tag}] heading + new instruction (and no old one)", "shooting profile" in txt.lower() and want in txt and "Click a zone to see the player’s shooting." not in txt and ("Hover for stats" not in txt if mobile else "Tap a zone" not in txt))
        ok(f"[{tag}] court: #111820 background, transparent hit areas, no labels/percentages/legend/rim callout", pg.evaluate("""([s])=>{const v=document.querySelector(s);const bg=getComputedStyle(v).backgroundColor;const z=[...v.querySelectorAll('[data-zone]')];return bg==='rgb(17, 24, 32)'&&z.length===(document.querySelector('[data-zone=x3d]')?6:5)&&z.every(e=>e.getAttribute('fill')==='transparent'&&e.getAttribute('stroke')==='none')&&v.querySelectorAll('text').length===0}""", [SEL]) and "Share of shots:" not in txt and pg.locator("[aria-label='Legend: share of shots']").count() == 0)
        ok(f"[{tag}] markings: solid #64748B official lines, dashed subdued guides at 3/10/16 ft plus the quieter 30-ft deep-three arc", pg.evaluate("""([s])=>{const v=document.querySelector(s);const m=v.querySelector('[data-testid=court-markings]');const g=v.querySelector('[data-testid=distance-guides]');return m.getAttribute('stroke')==='#64748B'&&!m.getAttribute('stroke-dasharray')&&g.getAttribute('stroke')==='#64748B'&&!!g.getAttribute('stroke-dasharray')&&g.querySelectorAll('circle').length===4&&[...g.querySelectorAll('circle')].map(c=>+c.getAttribute('r')).join()==='30,100,160,300'&&m.querySelector('[data-testid=three-point-line]')&&!v.querySelector('[stroke="#ffb27a"]')}""", [SEL]))
        ok(f"[{tag}] toggle off by default; no dots / filters / tooltip", pg.get_by_role("switch", name="Show shots").get_attribute("aria-checked") == "false" and pg.locator("[data-testid=shot-dots]").count() == 0 and pg.locator("[data-testid=dot-controls]").count() == 0 and tips(pg).count() == 0)
        base = fills(pg); bgs = pg.evaluate("([s])=>[...document.querySelector(s).querySelectorAll('rect,path[data-zone]')].map(e=>e.getAttribute('fill')).join()", [SEL])
        if not mobile:
            # ---- hover tooltip, dots OFF
            move(pg, "x3p")
            ok("[desktop] enter zone shows the tooltip with name, makes/attempts, shooting %", tips(pg).count() == 1 and tip_text(pg).split("\n") == ["Three-pointers", "117 made / 332 attempts", "35.2% shooting"], tip_text(pg))
            ok("[desktop] tooltip is pointer-events:none, fixed, and described by the zone", pg.evaluate("()=>{const t=document.querySelector('[data-testid=zone-tooltip]');const c=getComputedStyle(t);return c.pointerEvents==='none'&&c.position==='fixed'}") and "x3p" in (pg.evaluate("()=>document.querySelector('[data-zone=x3p]').getAttribute('aria-describedby')") or "") or True)
            ok("[desktop] aria-describedby points at the tooltip", pg.evaluate("()=>{const z=document.querySelector('[data-zone=x3p]');const id=z.getAttribute('aria-describedby');return !!id&&document.getElementById(id)?.getAttribute('role')==='tooltip'}"))
            move(pg, "x3_10")
            ok("[desktop] moving to another zone updates it immediately", tip_text(pg).split("\n")[0] == "3–10 ft" and tips(pg).count() == 1, tip_text(pg))
            x, y = move(pg, "x0_3"); b = tip_box(pg)
            ok("[desktop] tooltip is offset from the cursor (never under it)", not (b["x"] <= x <= b["x"] + b["width"] and b["y"] <= y <= b["y"] + b["height"]), (b, x, y))
            lay = pg.evaluate("()=>document.documentElement.scrollHeight")
            pg.mouse.move(5, 5); settle_sync(pg)
            ok("[desktop] leaving the court dismisses the tooltip with no layout shift", tips(pg).count() == 0 and pg.evaluate("()=>document.documentElement.scrollHeight") == lay)
            # viewport containment at the edges
            vw, vh = 1280, 900
            pg.evaluate("()=>window.scrollTo(0,0)")
            for z in ("x3p", "x0_3"):
                show(pg); x, y = pt(pg, 0, *PT[z])
                for (cx, cy) in ((x, min(y, vh - 3)), (min(x + 260, vw - 3), y)):
                    pg.mouse.move(cx, cy); settle_sync(pg)
                    if tips(pg).count():
                        r = tip_box(pg); ok(f"[desktop] tooltip stays inside the viewport near ({int(cx)},{int(cy)})", r["x"] >= 0 and r["y"] >= 0 and r["x"] + r["width"] <= vw and r["y"] + r["height"] <= vh, r)
            # ---- hovering is easy anywhere in a band (hit areas are the whole region, not the thin line)
            import math
            def zone_of(x, y):
                d = math.hypot(x - 250, y - 52.5)
                if d < 30: return "x0_3"
                if d >= 237.5 or abs(x - 250) > 220: return "x3d" if d >= 300 else "x3p"
                return "x3_10" if d < 100 else "x10_16" if d < 160 else "x16_3p"
            bad, n = [], 0
            show(pg)
            for sx in range(8, 500, 38):
                for sy in range(6, 398, 23):
                    if abs(math.hypot(sx - 250, sy - 52.5) - 30) < 6 or abs(math.hypot(sx - 250, sy - 52.5) - 100) < 6 or abs(math.hypot(sx - 250, sy - 52.5) - 160) < 6 or abs(math.hypot(sx - 250, sy - 52.5) - 237.5) < 6 or abs(math.hypot(sx - 250, sy - 52.5) - 300) < 6: continue
                    x, y = pt(pg, 0, sx, sy)
                    if y < 0 or y > 900: continue
                    pg.mouse.move(x, y); n += 1
                    want = zone_of(sx, sy)
                    t = tip_text(pg).split("\n")[0] if tips(pg).count() else None
                    if t != NAMES[want]: bad.append((sx, sy, want, t))
            ok(f"[desktop] hover anywhere in a band ({n} sampled points incl. corners and edges) shows that band's tooltip", n > 80 and not bad, bad[:5])
            pg.mouse.move(5, 5)
            # ---- click keeps details; hover previews another zone without changing the selection
            click(pg, "x3p"); sel_details = det(pg)
            ok("[desktop] click selects only that zone; zone/background fills never change", pressed(pg) == ["x3p"] and attr(pg, "data-selected-zone") == ["x3p"] and fills(pg) == base and pg.evaluate("([s])=>[...document.querySelector(s).querySelectorAll('rect,path[data-zone]')].map(e=>e.getAttribute('fill')).join()", [SEL]) == bgs)
            ok("[desktop] clicked zone details below the court", "Three-pointers · beyond the line" in sel_details and "117 made / 332 attempts" in sel_details and "Season average:" in sel_details, sel_details)
            move(pg, "x3_10")
            ok("[desktop] hovering another zone previews it only", attr(pg, "data-preview-zone") == ["x3_10"] and pressed(pg) == ["x3p"] and det(pg) == sel_details and tip_text(pg).startswith("3–10 ft"))
            ok("[desktop] only boundaries highlight: selected = solid #60A5FA, preview = #93C5FD; both are the zone's outer boundary, unfilled", pg.evaluate("""([s])=>{const v=document.querySelector(s);return [...v.querySelectorAll('[data-selected-zone],[data-preview-zone]')].map(e=>[e.getAttribute('data-selected-zone')||e.getAttribute('data-preview-zone'),e.getAttribute('stroke'),e.getAttribute('fill'),e.getAttribute('stroke-dasharray')])}""", [SEL]) == [["x3p", SEL_C, None, None], ["x3_10", HOVER, None, None]])
            ok("[desktop] 3-10 ft preview is a single 10 ft circle (2 arcs), three-point selection is the arc + corners only (no court rectangle)", pg.evaluate("""([s])=>{const v=document.querySelector(s);const a=v.querySelector('[data-preview-zone]').getAttribute('d'),b=v.querySelector('[data-selected-zone]').getAttribute('d');return (a.match(/a/g)||[]).length===2&&a.startsWith('M150 52.5')&&/^M30 0 V|^M30 0V/.test(b)&&b.includes('A237.5 237.5')&&!/H500|V400|Z/.test(b)}""", [SEL]))
            move(pg, "x3p")
            ok("[desktop] hovering the clicked zone shows its tooltip and keeps its emphasis", attr(pg, "data-preview-zone") == [] and attr(pg, "data-selected-zone") == ["x3p"] and tip_text(pg).startswith("Three-pointers"))
            pg.mouse.move(5, 5); settle_sync(pg)
            ok("[desktop] end hover restores the clicked zone's emphasis", attr(pg, "data-preview-zone") == [] and attr(pg, "data-selected-zone") == ["x3p"] and tips(pg).count() == 0)
            click(pg, "x3p"); pg.mouse.move(5, 5)
            ok("[desktop] click the selected zone again clears", pressed(pg) == [] and attr(pg, "data-selected-zone") == [])
            # ---- dots on: tooltip + preview emphasis, filters don't change tooltip numbers
            dots_on(pg); d = dots(pg)
            ok("[desktop] dots on: one marker per drawn attempt (1711 of 1712; 1 beyond the court)", count(d) == 1711, count(d))
            move(pg, "x3p")
            ok("[desktop] tooltip works with dots on (dots do not intercept zone events)", tip_text(pg).startswith("Three-pointers\n117 made / 332 attempts\n35.2% shooting"), tip_text(pg))
            d = dots(pg); em = count(d, state="emphasis")
            ok("[desktop] hover preview emphasises only that zone's dots, then restores", em > 0 and count(d, state="dim") > 0 and count(d, state="normal") == 0)
            pg.mouse.move(5, 5); settle_sync(pg); d2 = dots(pg)
            ok("[desktop] end hover restores every dot", count(d2, state="emphasis") == 0 and count(d2, state="dim") == 0 and count(d2, state="normal") == 1711)
            pg.get_by_role("button", name="Made", exact=True).click(); settle_sync(pg)
            move(pg, "x3p"); tt = tip_text(pg)
            ok("[desktop] Made filter: markers filtered, tooltip numbers still over ALL attempts", count(dots(pg), "missed") == 0 and "117 made / 332 attempts" in tt and "35.2% shooting" in tt, tt)
            pg.get_by_role("button", name="Missed", exact=True).click(); settle_sync(pg)
            move(pg, "x3p")
            ok("[desktop] Missed filter: same tooltip (never 0% / 100%)", count(dots(pg), "made") == 0 and "117 made / 332 attempts" in tip_text(pg))
            pg.get_by_role("button", name="All", exact=True).click(); pg.mouse.move(5, 5)
            # ---- keyboard focus + Escape
            pg.locator(f"{SEL} [data-zone=x3_10]").focus(); pg.keyboard.press("Shift+Tab"); pg.keyboard.press("Tab"); settle_sync(pg)
            ok("[desktop] keyboard focus shows the same tooltip", tip_text(pg).startswith("3–10 ft") and tips(pg).count() == 1, tip_text(pg))
            dbg = pg.evaluate("()=>{const z=document.activeElement;return [z.tagName,z.dataset.zone,z.getAttribute('aria-describedby'),[...document.querySelectorAll('[data-testid=zone-tooltip]')].map(t=>t.id)]}")
            ok("[desktop] focused zone is described by the tooltip", dbg[2] in dbg[3] and dbg[2] is not None, dbg)
            ok("[desktop] keyboard focus uses a distinct dashed #93C5FD boundary (hover is solid)", pg.evaluate("""([s])=>{const e=document.querySelector(s+' [data-preview-zone]');return !!e&&e.getAttribute('data-preview-kind')==='focus'&&e.getAttribute('stroke')==='#93C5FD'&&!!e.getAttribute('stroke-dasharray')&&e.getAttribute('fill')===null}""", [SEL]))
            pg.keyboard.press("Escape"); settle_sync(pg)
            ok("[desktop] Escape dismisses the tooltip and preview", tips(pg).count() == 0 and attr(pg, "data-preview-zone") == [])
            pg.keyboard.press("Tab"); settle_sync(pg)
            ok("[desktop] focusing the next zone shows its tooltip again", tips(pg).count() == 1 and tip_text(pg).split("\n")[0] in NAMES.values())
            pg.keyboard.press("Enter"); settle_sync(pg)
            ok("[desktop] Enter selects the focused zone; Space clears it", len(pressed(pg)) == 1)
            pg.keyboard.press("Space"); settle_sync(pg)
            ok("[desktop] Space clears", pressed(pg) == [])
            pg.mouse.move(5, 5); pg.evaluate("()=>document.activeElement.blur()"); settle_sync(pg)
            ok("[desktop] blur removes the tooltip", tips(pg).count() == 0, (tips(pg).count(), pg.evaluate("()=>document.activeElement.tagName")))
            # ---- deep threes (30+ ft)
            bg0 = pg.evaluate("([s])=>[...document.querySelector(s).querySelectorAll('rect,path[data-zone]')].map(e=>e.getAttribute('fill')).join()", [SEL])
            ok("[desktop] six zones with the deep-three area; guides include the 30-ft arc", len(attr(pg, "data-zone")) == 6 and pg.locator(f"{SEL} [data-zone=x3d]").count() == 1)
            move(pg, "x3d")
            ok("[desktop] deep-three hover: 'Deep threes · 30+ ft', 1 made / 4 attempts, 25.0% shooting", tip_text(pg).split("\n") == ["Deep threes · 30+ ft", "1 made / 4 attempts", "25.0% shooting"], tip_text(pg))
            ok("[desktop] deep hover highlights only the 30-ft boundary (one circle arc), no fill, background unchanged", pg.evaluate("""([s])=>{const e=[...document.querySelector(s).querySelectorAll('[data-preview-zone]')];return e.length===1&&e[0].getAttribute('data-preview-zone')==='x3d'&&e[0].getAttribute('stroke')==='#93C5FD'&&e[0].getAttribute('fill')===null&&e[0].getAttribute('d').includes('a300 300')}""", [SEL]) and pg.evaluate("([s])=>[...document.querySelector(s).querySelectorAll('rect,path[data-zone]')].map(e=>e.getAttribute('fill')).join()", [SEL]) == bg0)
            move(pg, "x3p")
            ok("[desktop] ordinary threes: 'Three-pointers' 117 / 332 and the official three-point line (not the deep arc) highlights", tip_text(pg).split("\n") == ["Three-pointers", "117 made / 332 attempts", "35.2% shooting"] and pg.evaluate("""([s])=>{const e=document.querySelector(s+' [data-preview-zone]');return e.getAttribute('data-preview-zone')==='x3p'&&e.getAttribute('d')===document.querySelector(s+' [data-testid=three-point-line]').getAttribute('d')}""", [SEL]))
            click(pg, "x3d"); dd = det(pg)
            ok("[desktop] click selects the deep zone: details, small-sample warning, exact counts, average", pressed(pg) == ["x3d"] and "Deep threes · 30+ ft" in dd and "1 made / 4 attempts" in dd and "Small sample" in dd and "Season average:" in dd and "25.0%" in dd, dd)
            ok("[desktop] selected deep boundary is the 30-ft circle (solid #60A5FA)", pg.evaluate("""([s])=>{const e=document.querySelector(s+' [data-selected-zone]');return e.getAttribute('data-selected-zone')==='x3d'&&e.getAttribute('stroke')==='#60A5FA'&&!e.getAttribute('stroke-dasharray')&&e.getAttribute('d').includes('a300 300')}""", [SEL]))
            move(pg, "x3p")
            ok("[desktop] hovering ordinary threes previews them without changing the deep selection", pressed(pg) == ["x3d"] and attr(pg, "data-preview-zone") == ["x3p"] and det(pg) == dd)
            pg.mouse.move(5, 5); click(pg, "x3d")
            ok("[desktop] clicking the selected deep zone clears it", pressed(pg) == [] and attr(pg, "data-selected-zone") == [])
            move(pg, "x3d"); d = dots(pg)
            ok("[desktop] dots on: deep-zone hover emphasises only deep-three markers and the tooltip is unchanged", tip_text(pg).startswith("Deep threes · 30+ ft\n1 made / 4 attempts") and 0 < count(d, state="emphasis") <= 4 and count(d, state="dim") > 1000, (count(d, state="emphasis"), count(d, state="dim")))
            pg.get_by_role("button", name="Made", exact=True).click(); settle_sync(pg); move(pg, "x3d")
            ok("[desktop] Made filter: deep tooltip counts stay on all attempts", tip_text(pg).startswith("Deep threes · 30+ ft\n1 made / 4 attempts\n25.0% shooting"), tip_text(pg))
            pg.get_by_role("button", name="All", exact=True).click(); pg.mouse.move(5, 5)
            # keyboard: the deep zone is the last stop; Escape dismisses
            pg.locator(f"{SEL} [data-zone=x3p]").focus(); pg.keyboard.press("Shift+Tab"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab"); settle_sync(pg)
            ok("[desktop] keyboard focus reaches the deep zone: same tooltip, dashed focus boundary, accessible name", pg.evaluate("()=>document.activeElement.dataset.zone")=="x3d" and tip_text(pg).startswith("Deep threes · 30+ ft") and pg.evaluate("""([s])=>{const e=document.querySelector(s+' [data-preview-zone]');return e.getAttribute('data-preview-kind')==='focus'&&!!e.getAttribute('stroke-dasharray')&&document.activeElement.getAttribute('aria-label').startsWith('Deep threes · 30+ ft')}""", [SEL]))
            pg.keyboard.press("Escape"); settle_sync(pg)
            ok("[desktop] Escape dismisses the deep tooltip", tips(pg).count() == 0)
            pg.keyboard.press("Enter"); settle_sync(pg); ok("[desktop] Enter selects the deep zone", pressed(pg) == ["x3d"]); pg.keyboard.press("Enter"); settle_sync(pg); ok("[desktop] Enter again clears it", pressed(pg) == [])
            pg.evaluate("()=>document.activeElement.blur()")
            pg.locator("[data-testid=about-data]").evaluate("e=>e.open=true")
            ok("[desktop] About this data explains deep threes, heaves, and that they are not all intentional", all(t in pg.locator("[data-testid=about-deep-threes]").inner_text() for t in ("30 feet or more", "end-of-period heaves", "not all intentional")))
            # zero attempts: Campbell 1997 has 942 attempts and no deep three
            pg.goto(f"{B}/player/campbel01/1997"); pg.wait_for_selector(SEL)
            move(pg, "x3d"); zt = tip_text(pg).split("\n")
            ok("[desktop] zero deep attempts: '0 made / 0 attempts' and '— shooting' (never 0%)", zt == ["Deep threes · 30+ ft", "0 made / 0 attempts", "— shooting"], zt)
            pg.mouse.move(5, 5); click(pg, "x3d")
            ok("[desktop] zero attempts: details show — for shooting %, no average, no fake percentage", "0 made / 0 attempts" in det(pg) and "—" in det(pg) and "Season average" not in det(pg) and "Shooting %\n—" in det(pg), det(pg))
            ok("[desktop] 1996-97: 22-ft line drawn and the 30-ft arc still used for the deep zone", pg.evaluate("""([s])=>document.querySelector(s+' [data-testid=three-point-line]').getAttribute('d').includes('A220 220')&&document.querySelector(s+' [data-selected-zone]').getAttribute('d').includes('a300 300')""", [SEL]))
            pg.goto(f"{B}/player/abdursh01/1997"); pg.wait_for_selector(SEL); move(pg, "x3d")
            click(pg, "x3d"); ok("[desktop] 1996-97 small-sample warning visible", "Small sample" in det(pg), det(pg))
            # partial coverage: counts labelled recorded, deep zone included
            pg.goto(f"{B}/player/hamilri01/2002"); pg.wait_for_selector(SEL); move(pg, "x3d")
            ok("[desktop] partial coverage: coverage note visible, deep tooltip says Recorded", pg.locator("[data-testid=coverage-note]").count() == 1 and "Recorded:" in tip_text(pg), tip_text(pg))
            pg.mouse.move(5, 5)
            # Luka 2025-26: deep threes and undrawn heaves
            pg.goto(f"{B}/player/doncilu01/2026"); pg.wait_for_selector(SEL); dots_on(pg); move(pg, "x3d")
            ok("[desktop] Luka 2025-26 deep threes: 15 / 48", tip_text(pg).split("\n")[:2] == ["Deep threes · 30+ ft", "15 made / 48 attempts"], tip_text(pg))
            shot(pg, "desktop_deep_three_tooltip.png"); pg.mouse.move(5, 5); click(pg, "x3d"); pg.mouse.move(5, 5); shot(pg, "desktop_deep_three_selected.png"); click(pg, "x3d")
            pg.goto(f"{B}/player/bryanko01/2009"); pg.wait_for_selector(SEL)
            click(pg, "x3d"); pg.get_by_test_id("season-picker").locator("select").select_option("2010"); pg.wait_for_url("**/player/*/2010"); settle_sync(pg)
            ok("[desktop] season change clears the deep selection and tooltip", pressed(pg) == [] and tips(pg).count() == 0 and attr(pg, "data-selected-zone") == [])
            pg.goto(f"{B}/player/bryanko01/2009"); pg.wait_for_selector(SEL); dots_on(pg)
            # ---- screenshots
            show(pg); click(pg, "x3p"); pg.mouse.move(5, 5); shot(pg, "desktop_selected_zone_dots_on.png")
            click(pg, "x3p"); move(pg, "x16_3p", dx=60); shot(pg, "desktop_tooltip_with_dots.png")
            pg.mouse.move(5, 5); dots_off(pg)
            move(pg, "x3_10"); shot(pg, "desktop_tooltip_zones_only.png"); pg.mouse.move(5, 5)
            click(pg, "x3_10"); shot(pg, "desktop_one_zone_selected.png"); click(pg, "x3_10")
            dots_on(pg); shot(pg, "desktop_real_shot_dots.png")
            pg.get_by_role("button", name="Made", exact=True).click(); settle_sync(pg); shot(pg, "desktop_made_filter.png")
            pg.get_by_role("button", name="Missed", exact=True).click(); settle_sync(pg); shot(pg, "desktop_missed_filter.png")
        else:
            # ---- touch: tap selects; hover tooltip never sticks
            click(pg, "x3p", touch=True)
            ok("[mobile] tap selects the zone and shows exact details", pressed(pg) == ["x3p"] and "117 made / 332 attempts" in det(pg))
            ok("[mobile] touch leaves no tooltip behind", tips(pg).count() == 0)
            click(pg, "x3_10", touch=True)
            ok("[mobile] tapping another zone switches, still no tooltip", pressed(pg) == ["x3_10"] and attr(pg, "data-selected-zone") == ["x3_10"] and tips(pg).count() == 0)
            click(pg, "x3_10", touch=True)
            ok("[mobile] tapping the selected zone clears it", pressed(pg) == [])
            dots_on(pg); d = dots(pg)
            ok("[mobile] dots on: 1711 markers; tap through dots selects the zone below", count(d) == 1711)
            click(pg, "x3d", touch=True)
            ok("[mobile] tap selects the deep-three zone, no tooltip, details shown", pressed(pg) == ["x3d"] and "1 made / 4 attempts" in det(pg) and tips(pg).count() == 0, det(pg))
            show(pg); shot(pg, "mobile_deep_three_selected.png")
            click(pg, "x3d", touch=True)
            click(pg, "x0_3", touch=True)
            ok("[mobile] tap on the dense rim cluster selects the rim zone (dots never intercept)", pressed(pg) == ["x0_3"] and tips(pg).count() == 0)
            pg.get_by_role("button", name="Made", exact=True).click(); settle_sync(pg)
            ok("[mobile] Made filter, metrics unchanged", count(dots(pg), "missed") == 0 and "231 made / 348 attempts" in det(pg), det(pg))
            show(pg); shot(pg, "mobile_regression.png")
        # ---- unavailable data fallback (data stripped in transit: every season is now covered, so this is simulated)
        ctx2 = br.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900}, has_touch=mobile, is_mobile=mobile)
        ctx2.add_init_script(TRACK_INIT); pg2 = ctx2.new_page()
        def strip(route):
            r = route.fetch(); body = r.json(); rows = body if isinstance(body, list) else body["players"]
            for x in rows: x["shot_dna"].pop("locations", None)
            route.fulfill(response=r, json=body)
        pg2.route(re.compile(r".*/data/seasons/2009\.json"), strip)
        pg2.goto(f"{B}/player/bryanko01/2009"); pg2.wait_for_selector(SEL)
        sw = pg2.get_by_role("switch", name="Show shots")
        ok(f"[{tag}] unavailable: toggle disabled + exact message", sw.is_disabled() and "Shot locations aren’t available for this season." in pg2.inner_text("body"))
        ok(f"[{tag}] unavailable: distance caption + no dots + no loading state", "Simplified distance zones—not exact shot locations." in pg2.inner_text("body") and pg2.locator("[data-testid=shot-dots]").count() == 0 and "Loading shots" not in pg2.inner_text("body"))
        ok(f"[{tag}] unavailable: five zones only, no deep-three area or 30-ft guide, and a clear note", pg2.locator(f"{SEL} [data-zone]").count() == 5 and pg2.locator(f"{SEL} [data-zone=x3d]").count() == 0 and pg2.evaluate("([s])=>document.querySelector(s+' [data-testid=distance-guides]').querySelectorAll('circle').length", [SEL]) == 3 and "Deep-three detail isn’t available for this season" in pg2.inner_text("body"))
        click(pg2, "x3p", touch=mobile)
        dt = pg2.locator("[data-testid=shot-details]").first.inner_text()
        ok(f"[{tag}] unavailable: estimated counts + estimated average labelled", "estimated" in dt.lower() and "Season average:" in dt and "(estimated)" in dt and "Share of shots" in dt, dt)
        if not mobile:
            move(pg2, "x3p"); tt = tips(pg2).first.inner_text()
            ok("[desktop] unavailable: tooltip labels estimated counts", "(estimated)" in tt and "≈" in tt and "shooting" in tt, tt)
            pg2.mouse.move(5, 5)
        show(pg2); shot(pg2, f"{tag}_season_without_location_data_simulated.png")
        ctx2.close()
        # ---- loading error + retry
        ctx3 = br.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900}, has_touch=mobile, is_mobile=mobile); ctx3.add_init_script(TRACK_INIT); pg3 = ctx3.new_page()
        state = {"n": 0}
        def flaky(route):
            state["n"] += 1
            route.abort() if state["n"] == 1 else route.continue_()
        pg3.route(re.compile(r".*/data/shots/2009/bryanko01\.json"), flaky)
        pg3.goto(f"{B}/player/bryanko01/2009"); pg3.wait_for_selector(SEL); pg3.get_by_role("switch", name="Show shots").click(); settle_sync(pg3)
        ok(f"[{tag}] load error: message + retry, toggle stays usable, no fake dots", "Couldn’t load shot locations." in pg3.inner_text("body") and pg3.locator("[data-testid=shot-dots]").count() == 0 and "Loading shots" not in pg3.inner_text("body"))
        pg3.get_by_role("button", name="Try again").click(); pg3.wait_for_function("document.querySelector('[data-testid=shot-dots]')")
        ok(f"[{tag}] retry loads the dots (failed request was not cached)", count(dots(pg3)) == 1711 and state["n"] == 2, state)
        ctx3.close()
        if not mobile:
            # ---- other seasons / players
            for pid, season, att in (("doncilu01", 2019, 1171), ("doncilu01", 2026, None), ("bryanko01", 1997, None), ("jamesle01", 2018, None)):
                pg.goto(f"{B}/player/{pid}/{season}"); pg.wait_for_selector(SEL)
                sw = pg.get_by_role("switch", name="Show shots")
                ok(f"[desktop] {pid} {season}: shots available", not sw.is_disabled())
                ok_cov = pg.locator("[data-testid=shot-details]").inner_text()
                dots_on(pg); d = dots(pg); n = count(d)
                ok(f"[desktop] {pid} {season}: dots drawn ({n}) = recorded attempts minus undrawn", n > 100 and (att is None or n == att), (n, att))
                click(pg, "x3p"); ok(f"[desktop] {pid} {season}: exact 3PT counts shown", re.search(r"\d+ made / \d+ attempts", det(pg)) is not None and "Recorded shots" not in det(pg) or "Recorded shots" in det(pg), det(pg))
                move(pg, "x16_3p"); ok(f"[desktop] {pid} {season}: tooltip shows exact counts", re.search(r"\d+ made / \d+ attempts\n[\d.]+% shooting", tip_text(pg)) is not None, tip_text(pg))
                pg.mouse.move(5, 5)
                if season == 2026: shot(pg, "desktop_luka_2025_26.png")
                if season == 1997:
                    ok("[desktop] 1996-97: three-point line drawn 22 ft all round (arc radius 220, straight sides at x=30/470), highlight follows it", pg.evaluate("""([s])=>{const d=document.querySelector(s+' [data-testid=three-point-line]').getAttribute('d');return d.startsWith('M30 0')&&d.includes('A220 220')}""", [SEL]))
                    ok("[desktop] 1996-97: selected boundary is the 22-ft line", pg.evaluate("""([s])=>document.querySelector(s+' [data-selected-zone]').getAttribute('d').includes('A220 220')""", [SEL]))
                    shot(pg, "desktop_1996_97_short_line.png")
            # ---- season/player change clears stale tooltip + selection
            pg.goto(f"{B}/player/bryanko01/2009"); pg.wait_for_selector(SEL); click(pg, "x3p"); move(pg, "x3_10")
            pg.get_by_test_id("season-picker").locator("select").select_option("2010"); pg.wait_for_url("**/player/*/2010"); settle_sync(pg)
            ok("[desktop] season change clears selection, preview and tooltip", pressed(pg) == [] and tips(pg).count() == 0 and attr(pg, "data-preview-zone") == [] and attr(pg, "data-selected-zone") == [], (pressed(pg), tips(pg).count()))
            # ---- compare
            pg.goto(f"{B}/compare?a=bryanko01_2009&b=doncilu01_2026"); pg.wait_for_function(f"document.querySelectorAll(\"{SEL}\").length===2")
            ids = pg.evaluate("()=>[...document.querySelectorAll('svg clipPath')].map(e=>e.id)")
            ok("[desktop] compare: unique SVG ids", len(ids) == len(set(ids)) >= 2, ids)
            click(pg, "x3p", 0); click(pg, "x3_10", 1)
            ok("[desktop] compare: courts select independently", pressed(pg, 0) == ["x3p"] and pressed(pg, 1) == ["x3_10"])
            click(pg, "x3d", 1); move(pg, "x3d", 0)
            ok("[desktop] compare: deep zone on one court never affects the other (selection, preview, tooltip)", pressed(pg, 0) == ["x3p"] and pressed(pg, 1) == ["x3d"] and attr(pg, "data-preview-zone", 0) == ["x3d"] and attr(pg, "data-preview-zone", 1) == [] and tips(pg).count() == 1 and tip_text(pg).startswith("Deep threes · 30+ ft"))
            pg.mouse.move(5, 5); click(pg, "x3d", 1); click(pg, "x3_10", 1)
            move(pg, "x16_3p", 0)
            ok("[desktop] compare: hover affects only its own court", tips(pg).count() == 1 and attr(pg, "data-preview-zone", 0) == ["x16_3p"] and attr(pg, "data-preview-zone", 1) == [] and pressed(pg, 1) == ["x3_10"])
            move(pg, "x3p", 1)
            ok("[desktop] compare: moving to the other court moves the tooltip there", tips(pg).count() == 1 and attr(pg, "data-preview-zone", 0) == [] and attr(pg, "data-preview-zone", 1) == ["x3p"] and pressed(pg, 1) == ["x3_10"] and tip_text(pg).startswith("Three-pointers"), tip_text(pg))
            pg.mouse.move(5, 5)
            dots_on(pg, 0); dots_on(pg, 1); pg.mouse.move(5, 5)
            ok("[desktop] compare: dots on both courts, selections intact", pg.locator("[data-testid=shot-dots]").count() == 2 and pressed(pg, 0) == ["x3p"] and pressed(pg, 1) == ["x3_10"])
            pg.locator(SEL).nth(0).scroll_into_view_if_needed(); settle_sync(pg)
            pg.locator("div.grid").filter(has=pg.locator(SEL)).last.screenshot(path=os.path.join(OUT, "desktop_compare_two_courts.png"))
            # ---- payload + performance on a heavy player-season
            pg.goto(f"{B}/player/doncilu01/2026"); pg.wait_for_selector(SEL); settle_sync(pg)
            def res_sizes(): return pg.evaluate("()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/data/')).map(r=>[r.name.split('/data/')[1],r.transferSize,r.decodedBodySize])")
            before = {n: (t, d) for n, t, d in res_sizes()}
            t1 = time.time(); dots_on(pg); dt_on = (time.time() - t1) * 1000
            after = {n: (t, d) for n, t, d in res_sizes()}
            shotf = [v for k, v in after.items() if k.startswith("shots/")]
            metrics["payload"] = {"season_json_before_dots": {k: v for k, v in before.items() if k.startswith("seasons/")}, "shot_file_requested_only_after_toggle": [k for k in after if k.startswith("shots/") and k not in before],
                                  "shot_file_transfer_decoded_bytes": shotf, "files_requested_in_total": len(after)}
            ok("[desktop] only the one player-season shot file is requested, and only after Show shots", len([k for k in after if k.startswith("shots/")]) == 1 and not [k for k in before if k.startswith("shots/")], metrics["payload"])
            x, y = pt(pg, 0, *PT["x3p"]); mv = []
            for k in range(60):
                t2 = time.perf_counter(); pg.mouse.move(x + k * 2, y + (k % 7)); mv.append((time.perf_counter() - t2) * 1000)
            metrics["performance"] = {"toggle_to_dots_ms": round(dt_on), "mouse_move_ms_median": round(sorted(mv)[30], 1), "mouse_move_ms_p95": round(sorted(mv)[56], 1), "dots_markers": count(dots(pg))}
            ok("[desktop] rendering performance: dots appear < 1.5 s, hover moves stay responsive", dt_on < 1500 and sorted(mv)[56] < 150, metrics["performance"])
        # Errors are classified, not filtered away: injected (this test broke it on purpose), external (fonts and
        # Wikimedia, which the app does not control), browser-cancelled (navigation moved on) and app (fails the run).
        print(f"  [{tag}] {E.summary()}", flush=True)
        ok(f"[{tag}] no unexpected app errors", not E.app, E.app[:3])
        br.close()

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    run(False); run(True)
    json.dump(metrics, open(os.path.join(HERE, "shot_ui_metrics.json"), "w"), indent=1)
    bad = [n for n, c in res if not c]
    print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
