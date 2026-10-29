/**
 * Signing in to LCR from inside the app.
 *
 * LCR's sign-in (Okta, with a code sent to the owner's phone) needs a real
 * browser. On a computer the app opens a window for it. A cloud server has
 * no screen, so instead the server runs that browser out of sight and the
 * app shows it: a picture of the page, refreshed a few times a second, with
 * the owner's taps and typing sent back to it. Whatever LCR's sign-in looks
 * like next year — another field, another kind of code — this keeps
 * working, because nothing here knows what the page contains. It only looks
 * for the moment the browser lands on the report, and then keeps the
 * session exactly as the window sign-in always has.
 *
 * Nothing typed is stored or logged; it goes into the page and nowhere
 * else. One sign-in at a time, and it gives up after ten quiet minutes.
 */

const VIEW = { width: 420, height: 760 };       // a phone-shaped page: the owner may be on one
const IDLE_LIMIT = 10 * 60 * 1000;

class LoginRelay {
  /**
   * @param {object} o
   *   startUrl   where the sign-in starts (the report; LCR bounces to Okta)
   *   isDone     (url) => true once the browser has reached the report
   *   save       async (context) => keep the signed-in session
   *   launch     async () => a Playwright browser
   */
  constructor(o) {
    this.o = o;
    this.state = "starting";     // starting | signing-in | saving | done | failed | timeout
    this.message = "";
    this.browser = null;
    this.page = null;
    this.touched = Date.now();
    this.steady = 0;
  }

  async start() {
    try {
      this.browser = await this.o.launch();
      const ctx = await this.browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      this.ctx = ctx;
      this.page = await ctx.newPage();
      await this.page.goto(this.o.startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      this.state = "signing-in";
      this.watch();
    } catch (err) {
      this.state = "failed";
      this.message = "The sign-in page could not be opened: " + err.message;
      await this.close();
    }
    return this;
  }

  // Watch for arrival at the report; require it to hold for a few seconds so
  // a redirect passing through is not mistaken for the end.
  watch() {
    this.timer = setInterval(async () => {
      if (!this.page || this.state !== "signing-in") return;
      if (Date.now() - this.touched > IDLE_LIMIT) {
        this.state = "timeout"; this.message = "The sign-in sat idle for ten minutes and was closed.";
        return this.close();
      }
      let url = "";
      try { url = this.page.url(); } catch (_) { return; }
      if (this.o.isDone(url)) {
        this.steady += 1;
        if (this.steady >= 3) {
          this.state = "saving";
          try {
            await this.o.save(this.ctx);
            this.state = "done";
          } catch (err) {
            this.state = "failed"; this.message = "Signed in, but the session could not be kept: " + err.message;
          }
          await this.close();
        }
      } else {
        this.steady = 0;
      }
    }, 1000);
  }

  async frame() {
    if (!this.page) return null;
    return this.page.screenshot({ type: "jpeg", quality: 70 });
  }

  // Coordinates arrive as fractions of the picture, so it does not matter
  // how large the picture was drawn on the owner's screen.
  async tap(fx, fy) {
    this.touched = Date.now();
    const x = Math.max(0, Math.min(1, +fx)) * VIEW.width;
    const y = Math.max(0, Math.min(1, +fy)) * VIEW.height;
    await this.page.mouse.click(x, y);
  }

  async type(text) {
    this.touched = Date.now();
    await this.page.keyboard.type(String(text).slice(0, 500), { delay: 15 });
  }

  async press(key) {
    this.touched = Date.now();
    const allowed = new Set(["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift+Tab"]);
    if (!allowed.has(key)) throw new Error("key not allowed");
    await this.page.keyboard.press(key);
  }

  async scroll(dy) {
    this.touched = Date.now();
    await this.page.mouse.wheel(0, Math.max(-2000, Math.min(2000, +dy || 0)));
  }

  status() {
    return { state: this.state, message: this.message };
  }

  async close() {
    clearInterval(this.timer);
    const b = this.browser;
    this.browser = null; this.page = null;
    if (b) await b.close().catch(() => {});
  }
}

module.exports = { LoginRelay, VIEW };
