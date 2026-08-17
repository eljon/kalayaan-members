(() => {
  "use strict";

  let data = null;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ------------------------------------------------------------ curtain
  function curtain(title, body, actionLabel, onAction) {
    $("curtain").hidden = false;
    $("main").hidden = true;
    $("curtain-title").textContent = title;
    $("curtain-body").innerHTML = body;
    const btn = $("curtain-action");
    if (actionLabel) {
      btn.hidden = false;
      btn.textContent = actionLabel;
      btn.onclick = onAction;
    } else {
      btn.hidden = true;
    }
  }

  function raise() {
    $("curtain").hidden = true;
    $("main").hidden = false;
  }

  // ------------------------------------------------------------ header
  function renderMasthead() {
    $("unit-line").textContent = `Unit ${data.unitNumber} · ${data.weekOptions.length} weeks`;
    const when = new Date(data.fetchedAt);
    $("stamp").textContent = "Pulled " + when.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  // ------------------------------------------------------------ week rail
  function renderRail() {
    const rail = $("week-rail");
    rail.textContent = "";
    const peak = Math.max(...data.weekTotals.map((w) => w.total), 1);

    for (const w of data.weekTotals) {
      const box = el("div", "week");
      box.appendChild(el("span", "week-date", w.week));
      box.appendChild(el("span", "week-count", String(w.membersPresent)));
      box.appendChild(
        el("span", "week-sub", `+${w.visitors} visiting · ${w.total} in all`)
      );
      const bar = el("div", "week-bar");
      bar.style.width = "0%";
      box.appendChild(bar);
      rail.appendChild(box);
      requestAnimationFrame(() => {
        bar.style.width = Math.round((w.total / peak) * 100) + "%";
      });
    }

    const s = data.stats;
    const tally = $("tally");
    tally.textContent = "";
    const pairs = [
      ["On the roll", String(s.members)],
      ["Came at least once", String(s.attending)],
      ["Every week", String(s.everyWeek)],
      ["Not seen at all", String(s.absent), true],
    ];
    for (const [k, v, warn] of pairs) {
      const d = el("div");
      d.appendChild(el("dt", null, k));
      const dd = el("dd", warn ? "warn" : null, v);
      d.appendChild(dd);
      tally.appendChild(d);
    }
  }

  // ------------------------------------------------------------ controls
  function renderOrgs() {
    const sel = $("org");
    sel.textContent = "";
    const all = el("option", null, "All organizations");
    all.value = "";
    sel.appendChild(all);
    const seen = new Set();
    for (const o of data.orgList) {
      if (seen.has(o.uuid)) continue;
      seen.add(o.uuid);
      const opt = el("option", null, "\u00a0".repeat(o.depth * 2) + o.name);
      opt.value = o.uuid;
      sel.appendChild(opt);
    }
  }

  // ------------------------------------------------------------ the roll
  function renderHead() {
    const head = $("roll-head");
    head.textContent = "";
    head.appendChild(el("div", "h-name", "Name"));
    const weeks = el("div", "h-weeks");
    for (const w of data.weekOptions) {
      weeks.appendChild(el("div", "h-week", w.dateDisplay.split(" ")[0]));
    }
    head.appendChild(weeks);
    head.appendChild(el("div", "h-score", "Weeks"));
  }

  function visibleRows() {
    const q = $("q").value.trim().toLowerCase();
    const org = $("org").value;
    const hide = $("hide-absent").checked;
    const order = $("sort").value;

    let rows = data.rows;
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    if (org) rows = rows.filter((r) => r.orgIds.includes(org));
    if (hide) rows = rows.filter((r) => r.total > 0);

    rows = rows.slice();
    if (order === "gaps") {
      rows.sort((a, b) => a.total - b.total || a.nameSort.localeCompare(b.nameSort));
    } else if (order === "most") {
      rows.sort((a, b) => b.total - a.total || a.nameSort.localeCompare(b.nameSort));
    } else {
      rows.sort((a, b) => a.nameSort.localeCompare(b.nameSort));
    }
    return rows;
  }

  function renderBody() {
    const body = $("roll-body");
    const rows = visibleRows();
    const weeks = data.weekOptions.length;

    body.textContent = "";
    $("roll-empty").hidden = rows.length > 0;

    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const gone = r.total === 0;
      const row = el("div", "roll-row" + (gone ? " r-gone" : ""));

      const name = el("div", "r-name");
      name.appendChild(document.createTextNode(r.name));
      name.appendChild(
        el("span", "r-orgs", r.orgs.length ? r.orgs.join(" · ") : "No organization listed")
      );
      row.appendChild(name);

      const cells = el("div", "r-cells");
      for (const on of r.cells) {
        cells.appendChild(
          el("i", "cell" + (on ? " on" : gone ? " gone" : ""))
        );
      }
      row.appendChild(cells);

      row.appendChild(el("div", "r-score", `${r.total}/${weeks}`));
      frag.appendChild(row);
    }
    body.appendChild(frag);
  }

  function renderAll() {
    renderMasthead();
    renderRail();
    renderHead();
    renderBody();
  }

  // ------------------------------------------------------------ flow

  let polling = null;

  function startPolling() {
    stopPolling();
    polling = setInterval(async () => {
      try {
        const s = await (await fetch("/api/state")).json();
        if (s.progress) $("curtain-body").textContent = s.progress;
      } catch (_) {
        /* server restarting */
      }
    }, 900);
  }
  function stopPolling() {
    if (polling) clearInterval(polling);
    polling = null;
  }

  async function boot() {
    let s;
    try {
      s = await (await fetch("/api/state")).json();
    } catch (_) {
      return curtain(
        "The app stopped running",
        "Start it again with <code>npm start</code> in the project folder."
      );
    }

    if (s.hasData) {
      data = await (await fetch("/api/data")).json();
      raise();
      renderOrgs();
      renderAll();
      // A stale roll refreshes itself so the numbers on screen are current.
      if (s.stale && !s.busy) refresh({ quiet: true });
      return;
    }

    if (!s.signedIn) return askSignIn();
    return pull();
  }

  function askSignIn() {
    curtain(
      "Sign in to LCR",
      "A browser window will open. Sign in the way you normally do, including any code sent to your phone. " +
        "The roll fills in on its own once you're through.",
      "Open the sign-in window",
      signIn
    );
  }

  async function signIn() {
    working("Opening the sign-in window", "Finish signing in in the window that just opened.");
    startPolling();
    try {
      const res = await fetch("/api/login", { method: "POST" });
      stopPolling();
      if (res.ok) return arrive(await res.json());

      const { error, detail } = await res.json();
      if (error === "LOGIN_TIMEOUT") {
        curtain(
          "Sign-in did not finish",
          "The window closed before you got through to the report. Try again when you're ready.",
          "Open the sign-in window",
          signIn
        );
      } else {
        curtain(
          "Sign-in did not work",
          detail || "The browser could not reach LCR.",
          "Try again",
          signIn
        );
      }
    } catch (_) {
      stopPolling();
      curtain("The app stopped running", "Start it again with <code>npm start</code>.");
    }
  }

  async function pull() {
    working("Reading the report", "Pulling the latest attendance from LCR.");
    startPolling();
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      stopPolling();
      if (res.ok) return arrive(await res.json());

      const { error, detail } = await res.json();
      if (error === "SESSION_EXPIRED") return sessionGone();
      curtain(
        "The pull did not finish",
        (detail || "LCR did not return the report.") +
          " If this keeps happening, LCR may have changed its page structure.",
        "Try again",
        pull
      );
    } catch (_) {
      stopPolling();
      curtain("The app stopped running", "Start it again with <code>npm start</code>.");
    }
  }

  function sessionGone() {
    curtain(
      "Your LCR session expired",
      "Sessions last a few days. Sign in again and the roll will refresh itself.",
      "Open the sign-in window",
      signIn
    );
  }

  function arrive(fresh) {
    data = fresh;
    raise();
    renderOrgs();
    renderAll();
  }

  // Refresh from the header, without hiding the roll you're already reading.
  async function refresh(opts = {}) {
    const btn = $("refresh");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Reading LCR\u2026";
    document.body.classList.add("working");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (res.ok) {
        data = await res.json();
        renderAll();
      } else {
        const { error, detail } = await res.json();
        if (error === "SESSION_EXPIRED") sessionGone();
        else if (!opts.quiet)
          curtain("The pull did not finish", detail || "LCR did not return the report.", "Try again", pull);
      }
    } catch (_) {
      if (!opts.quiet) curtain("The app stopped running", "Start it again with <code>npm start</code>.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
      document.body.classList.remove("working");
    }
  }

  function working(title, body) {
    curtain(title, body);
    const btn = $("curtain-action");
    btn.hidden = true;
  }

  // ------------------------------------------------------------ wiring
  let t;
  const debounce = () => { clearTimeout(t); t = setTimeout(renderBody, 120); };
  $("q").addEventListener("input", debounce);
  $("org").addEventListener("change", renderBody);
  $("sort").addEventListener("change", renderBody);
  $("hide-absent").addEventListener("change", renderBody);
  $("refresh").addEventListener("click", () => refresh());
  $("export").addEventListener("click", (e) => {
    e.currentTarget.href = $("hide-absent").checked
      ? "/api/export.csv?scope=attended"
      : "/api/export.csv";
  });

  boot();
})();
