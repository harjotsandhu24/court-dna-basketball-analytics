"""Automated accessibility (axe-core), touch-target and layout-shift (CLS) audit. Chromium only.

Conditions for the CLS numbers (NOT real-user data): headless Chromium, localhost production build, no network
throttling, cache cold on the first load, 5 loads per page, median reported; viewports 1280x900 and 390x844.
Not tested: NVDA, VoiceOver, Firefox, Safari. axe finds roughly a third of WCAG problems; it is not a certification.
Usage: AXE=/path/to/axe.min.js python3 docs/qa/a11y_perf_qa.py"""
import json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from qa_common import TRACK_INIT, B, settle_sync, ok, finish
AXE = open(os.environ.get("AXE", "/tmp/claude-0/axe/node_modules/axe-core/axe.min.js")).read()
REAL5 = {"v": 1, "slots": [{"id": i, "season": 2005} for i in ("nashst01", "johnsjo02", "mariosh01", "richaqu01", "stoudam01")]}
SEED = "try{localStorage.setItem('courtdna.lineup.v1'," + json.dumps(json.dumps(REAL5)) + ")}catch(e){}"
PAGES = [("home", "/", None), ("profile", "/player/bryanko01/2009", "svg[aria-label^='Shooting profile']"),
         ("career", "/career/bryanko01", "table"), ("compare-empty", "/compare", None),
         ("compare", "/compare?a=bryanko01_2009&b=jamesle01_2013", "[data-testid=compare-slot-a]"),
         ("galaxy", "/galaxy", "canvas, svg"), ("methodology", "/methodology", "table"), ("build", "/build-a-five", None)]
VIEWS = {"desktop": dict(viewport={"width": 1280, "height": 900}), "phone": dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)}
CLS_JS = "new Promise(r=>{let v=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)v+=e.value}).observe({type:'layout-shift',buffered:true});setTimeout(()=>r(v),2500)})"
CLS_INIT = "window.__cls=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true})}catch(e){}"
TOUCH_JS = """()=>{const out=[];for(const e of document.querySelectorAll('a,button,select,input,[role=button],[role=switch],[role=tab]')){
 const r=e.getBoundingClientRect();const cs=getComputedStyle(e);if(!r.width||!r.height||cs.visibility==='hidden'||cs.display==='none')continue;
 if(e.closest('[aria-hidden=true]')||e.className&&String(e.className).includes('sr-only'))continue;
 if(e.tagName==='A'&&e.closest('p,li,span,footer')&&cs.display==='inline')continue;
 if(r.height<44||r.width<44)out.push((e.getAttribute('aria-label')||e.innerText||e.getAttribute('name')||e.tagName).trim().slice(0,40)+' '+Math.round(r.width)+'x'+Math.round(r.height))}
 return out}"""
report = {"axe": {}, "touch": {}, "cls": {}}
with sync_playwright() as p:
    br = p.chromium.launch()
    for vname, kw in VIEWS.items():
        for name, path, wait in PAGES:
            ctx = br.new_context(**kw); ctx.add_init_script(TRACK_INIT)
            if name == "build": ctx.add_init_script(SEED)
            pg = ctx.new_page(); pg.goto(B + path)
            if wait:
                try: pg.wait_for_selector(wait, timeout=15000)
                except Exception: pass
            settle_sync(pg)
            if name == "build":
                pg.wait_for_selector("[data-testid=sim-results]", timeout=60000) if pg.locator("[data-testid=sim-results]").count() else None
            pg.wait_for_function("document.getAnimations().every(a=>a.playState!=='running')", timeout=10000)  # let CSS transitions finish; axe would read mid-fade colours
            pg.evaluate(AXE)
            r = pg.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']})")
            v = [(x["id"], x["impact"], len(x["nodes"])) for x in r["violations"]]
            report["axe"][f"{vname}/{name}"] = v
            serious = [x for x in v if x[1] in ("serious", "critical")]
            ok(f"[{vname}] axe {name}: no serious/critical violations", not serious, serious)
            report["touch"][f"{vname}/{name}"] = pg.evaluate(TOUCH_JS) if vname == "phone" else []
            ctx.close()
    # CLS: 5 cold loads per page, median
    for vname, kw in VIEWS.items():
        for name, path, wait in [x for x in PAGES if x[0] in ("compare", "galaxy", "profile", "home")]:
            vals = []
            for _ in range(5):
                ctx = br.new_context(**kw); ctx.add_init_script(CLS_INIT); ctx.add_init_script(TRACK_INIT)
                pg = ctx.new_page(); pg.goto(B + path)
                try: pg.wait_for_selector(wait or "h1", timeout=15000)
                except Exception: pass
                settle_sync(pg); pg.wait_for_timeout(1500)  # a measurement window, not a synchronisation sleep
                vals.append(pg.evaluate("window.__cls")); ctx.close()
            m = statistics.median(vals); report["cls"][f"{vname}/{name}"] = {"median": round(m, 3), "runs": [round(x, 3) for x in vals]}
            ok(f"[{vname}] CLS {name} median {m:.3f} <= 0.10", m <= 0.10, vals)
    br.close()
json.dump(report, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "a11y_perf_metrics.json"), "w"), indent=1)
offenders = {k: v for k, v in report["touch"].items() if v}
print("touch targets under 44px (phone):", json.dumps(offenders, indent=1)[:3000])
print("axe non-serious:", json.dumps({k: [x for x in v if x[1] not in ('serious','critical')] for k, v in report["axe"].items()})[:3000])
finish()
