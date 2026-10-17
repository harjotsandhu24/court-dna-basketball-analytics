"""Shared helpers for the browser QA scripts (Chromium via Playwright).

What this module is for
-----------------------
* ok()/finish(): one pass/fail ledger and exit code.
* settle(page): the replacement for fixed sleeps. It waits for REAL state: no request the app started is still in
  flight, and two animation frames have painted. A test waits for content with wait_for_selector/expect-style waits and
  uses settle() only where the thing it needs is "the app has finished reacting".
* Error tracking that keeps three kinds of problems apart instead of hiding errors broadly:
    - injected   : a failure this test caused on purpose (an aborted or 500 request it registered). Expected.
    - external   : a request to a third party the app does not control (Wikimedia photo hosting). Reported
                   separately; never a failure of the app, but never silent either.
    - app        : anything else (uncaught exceptions, other console errors). These fail the run.
* PHOTO_PNG: a controlled photo fixture so photo tests do not depend on Wikimedia being reachable.

Limitations (stated, not hidden): Chromium only. No NVDA/VoiceOver, no Firefox/Safari.
"""
import asyncio, base64, os, re, sys

B = os.environ.get("QA_BASE", "http://localhost:3100")
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SHOTS = os.path.join(ROOT, "docs", "screenshots", "phase11")
os.makedirs(SHOTS, exist_ok=True)

res: list[bool] = []

def ok(name, cond, detail=""):
    res.append(bool(cond))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f" -- {str(detail)[:300]}"), flush=True)

def finish(extra=None):
    bad = res.count(False)
    print(f"\n{len(res) - bad}/{len(res)} checks passed")
    if extra:
        print(extra)
    sys.exit(1 if bad else 0)

# A 1x1 opaque PNG: the "photo loaded" fixture.
PHOTO_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# Counts requests the page started that have not finished, so settle() can wait for the app to go quiet.
TRACK_INIT = """
(() => {
  if (window.__qaTrack) return;
  window.__qaTrack = { inflight: 0 };
  const f = window.fetch;
  window.fetch = function () {
    window.__qaTrack.inflight++;
    return f.apply(this, arguments).finally(() => { window.__qaTrack.inflight--; });
  };
})();
"""

async def settle(pg, allow=0, timeout=15000):
    """Wait until the app has at most `allow` requests in flight and has painted twice. Replaces fixed sleeps.
    allow=0 means fully quiet. Tests that deliberately hold one request open (a slow download they are probing)
    pass allow=1 to wait for the UI to reach its loading state, then settle() fully to wait for the answer."""
    await pg.wait_for_function(f"!window.__qaTrack || window.__qaTrack.inflight <= {int(allow)}", timeout=timeout)
    # two paints, then wait for any smooth scroll to finish (the scroll position stays put for several frames)
    await pg.evaluate("""new Promise(res => {
      let last = [window.scrollX, window.scrollY], still = 0, frames = 0;
      const tick = () => {
        frames++;
        const now = [window.scrollX, window.scrollY];
        still = (now[0] === last[0] && now[1] === last[1]) ? still + 1 : 0;
        last = now;
        if ((still >= 4 && frames >= 2) || frames > 150) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })""")

EXTERNAL = re.compile(r"upload\.wikimedia\.org|wikimedia\.org|wikipedia\.org|fonts\.googleapis\.com|fonts\.gstatic\.com", re.I)

class Errors:
    """Collects page errors and console errors for one page, classified."""
    def __init__(self):
        self.injected: list[str] = []
        self.external: list[str] = []
        self.cancelled: list[str] = []
        self.app: list[str] = []
        self._inject_patterns: list[re.Pattern] = []

    def expect_injected(self, pattern):
        """Register a URL substring/regex this test is about to break on purpose."""
        self._inject_patterns.append(re.compile(pattern) if isinstance(pattern, str) else pattern)

    def classify(self, text, url=""):
        blob = f"{text} {url}"
        if "ERR_ABORTED" in blob and not any(p.search(blob) for p in self._inject_patterns):
            # the browser itself cancelled an in-flight request (a navigation moved on, a page closed, a prefetch was
            # superseded). It is not a failed response; real failures (HTTP errors, refused connections) stay "app".
            self.cancelled.append(blob[:200])
        elif any(p.search(blob) for p in self._inject_patterns):
            self.injected.append(blob[:200])
        elif EXTERNAL.search(blob):
            self.external.append(blob[:200])
        else:
            self.app.append(blob[:300])

    def attach(self, pg):
        pg.on("pageerror", lambda e: self.classify(f"pageerror: {e}"))
        def on_console(m):
            if m.type != "error":
                return
            loc = m.location or {}
            self.classify(m.text, loc.get("url", "") if isinstance(loc, dict) else "")
        pg.on("console", on_console)
        # a failed request is reported by the browser as a console error without the URL in some cases, so also listen here
        pg.on("requestfailed", lambda r: self.classify(f"requestfailed {r.failure}", r.url))
        return self

    def summary(self):
        return f"errors: app={len(self.app)} injected={len(self.injected)} external(Wikimedia etc.)={len(self.external)} browser-cancelled={len(self.cancelled)}"

async def new_context(browser, **kw):
    ctx = await browser.new_context(**kw)
    await ctx.add_init_script(TRACK_INIT)
    return ctx

def delay(ms):
    async def h(route):
        await asyncio.sleep(ms / 1000)
        await route.continue_()
    return h

async def no_hscroll(pg):
    return await pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def settle_sync(pg, allow=0, timeout=15000):
    """Synchronous-Playwright twin of settle(): network quiet, two paints, scroll position stable."""
    pg.wait_for_function(f"!window.__qaTrack || window.__qaTrack.inflight <= {int(allow)}", timeout=timeout)
    pg.evaluate("""new Promise(res => {
      let last = [window.scrollX, window.scrollY], still = 0, frames = 0;
      const tick = () => {
        frames++;
        const now = [window.scrollX, window.scrollY];
        still = (now[0] === last[0] && now[1] === last[1]) ? still + 1 : 0;
        last = now;
        if ((still >= 4 && frames >= 2) || frames > 150) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })""")
