(() => {
  "use strict";

  let data = null;

  // The version of the front-end you are actually looking at, baked into
  // the page. Compared against the server's latest so an old /v<n> page
  // can tell you it is not current.
  const VIEWING = Number(
    (document.querySelector('meta[name=app-version]') || {}).content || 0
  );

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Group the week columns into calendar months, keeping the original
  // column indices so the header and each member row stay aligned. The
  // year is shown only when the span crosses one.
  function monthGroups() {
    const weeks = data.weekOptions || [];
    const showYear = new Set(weeks.map((w) => w.date.slice(0, 4))).size > 1;
    const groups = [];
    let cur = null;
    weeks.forEach((w, i) => {
      const ym = w.date.slice(0, 7);
      if (!cur || cur.ym !== ym) {
        const name = MONTH_NAMES[parseInt(w.date.slice(5, 7), 10) - 1] || "";
        cur = { ym, label: showYear ? `${name} ${w.date.slice(0, 4)}` : name, indices: [] };
        groups.push(cur);
      }
      cur.indices.push(i);
    });
    return groups;
  }

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
    const span = data.months ? ` · ${data.months} months` : "";
    $("unit-line").textContent =
      `Unit ${data.unitNumber} · ${data.weekOptions.length} weeks${span}`;
    const when = new Date(data.fetchedAt);
    $("stamp").textContent = "Pulled " + when.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

    // Compact people summary, replacing the old ledger tally. "Not seen"
    // stays in the alert color; it is the figure this app exists for.
    const s = data.stats;
    const sl = $("stats-line");
    if (sl) {
      sl.textContent = "";
      sl.appendChild(el("span", null, `${s.members} on the roll`));
      sl.appendChild(el("span", "sep", " · "));
      sl.appendChild(el("span", null, `${s.attending} seen`));
      sl.appendChild(el("span", "sep", " · "));
      sl.appendChild(el("span", null, `${s.everyWeek} every week`));
      sl.appendChild(el("span", "sep", " · "));
      sl.appendChild(el("span", "alert", `${s.absent} not seen`));
    }

    const notice = $("notice");
    if (data.warnings && data.warnings.length) {
      notice.hidden = false;
      notice.textContent = data.warnings.join("  ·  ");
    } else {
      notice.hidden = true;
    }
  }

  // Drop Sundays that have not happened yet, recomputing the per-week
  // totals, each row's cells, and the summary so a stale cache pulled
  // before this trip is cleaned at display time too. Idempotent: a fresh
  // pull (already trimmed server-side) has nothing to drop.
  function pruneFutureWeeks(d) {
    if (!d || !Array.isArray(d.weekOptions)) return d;
    const today = new Date().toISOString().slice(0, 10);
    const keep = [];
    d.weekOptions.forEach((w, i) => {
      if (w.date <= today) keep.push(i);
    });
    if (keep.length === d.weekOptions.length) return d;

    d.weekOptions = keep.map((i) => d.weekOptions[i]);
    if (Array.isArray(d.weekTotals)) d.weekTotals = keep.map((i) => d.weekTotals[i]);
    (d.rows || []).forEach((r) => {
      r.cells = keep.map((i) => r.cells[i]);
      r.total = r.cells.filter(Boolean).length;
    });
    const n = d.weekOptions.length;
    const attending = (d.rows || []).filter((r) => r.total > 0).length;
    d.stats = {
      members: d.rows.length,
      attending,
      absent: d.rows.length - attending,
      everyWeek: d.rows.filter((r) => r.total === n).length,
      avgPresent: d.weekTotals && d.weekTotals.length
        ? Math.round(d.weekTotals.reduce((a, w) => a + w.membersPresent, 0) / d.weekTotals.length)
        : 0,
    };
    return d;
  }

  // Show which version this page is, and whether it is behind the server.
  function renderVersion(latest) {
    const chip = $("version");
    if (!chip) return;
    if (latest && VIEWING && VIEWING < latest) {
      chip.textContent = `v${VIEWING} · latest is v${latest}`;
      chip.classList.add("warn");
    } else {
      chip.textContent = `v${VIEWING || latest || "?"}`;
      chip.classList.remove("warn");
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
    for (const g of monthGroups()) {
      const month = el("div", "h-month");
      month.appendChild(el("div", "h-month-label", g.label));
      const days = el("div", "h-days");
      for (const i of g.indices) {
        const wk = el("div", "h-week");
        wk.appendChild(el("span", "h-day", data.weekOptions[i].dateDisplay.split(" ")[0]));
        const t = data.weekTotals && data.weekTotals[i];
        wk.appendChild(el("span", "h-count", t ? String(t.membersPresent) : ""));
        days.appendChild(wk);
      }
      month.appendChild(days);
      weeks.appendChild(month);
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
    const groups = monthGroups();

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
      for (const g of groups) {
        const month = el("div", "r-month");
        for (const i of g.indices) {
          const on = r.cells[i];
          month.appendChild(el("i", "cell" + (on ? " on" : gone ? " gone" : "")));
        }
        cells.appendChild(month);
      }
      row.appendChild(cells);

      row.appendChild(el("div", "r-score", `${r.total}/${weeks}`));
      frag.appendChild(row);
    }
    body.appendChild(frag);
  }

  function renderAll() {
    renderMasthead();
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

    renderVersion(s.version);

    if (s.hasData) {
      data = pruneFutureWeeks(await (await fetch("/api/data")).json());
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
    data = pruneFutureWeeks(fresh);
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
        data = pruneFutureWeeks(await res.json());
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
