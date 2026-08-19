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

  // Sort preferences persist across sessions, one entry per table.
  const SORT_LS_KEY = "kalayaan:sort";
  function loadSorts() {
    try { return JSON.parse(localStorage.getItem(SORT_LS_KEY) || "{}"); } catch (_) { return {}; }
  }
  function saveSort(which, value) {
    const all = loadSorts();
    all[which] = value;
    try { localStorage.setItem(SORT_LS_KEY, JSON.stringify(all)); } catch (_) {}
  }

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
    $("tabs").hidden = false;
  }

  // ------------------------------------------------------------ header
  // "X of Y people" when a filter is narrowing the list, plain "Y people"
  // when everything is showing; an optional trailing clause (fields, columns).
  function countText(shown, total, noun, extra) {
    const base = shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
    return extra ? `${base} · ${extra}` : base;
  }

  function renderMasthead() {
    const when = new Date(data.fetchedAt);
    $("stamp").textContent = "Pulled " + when.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

    const notice = $("notice");
    if (data.warnings && data.warnings.length) {
      notice.hidden = false;
      notice.textContent = data.warnings.join("  ·  ");
    } else {
      notice.hidden = true;
    }
  }

  // The roster summary, moved out of the masthead into a prominent widget
  // above the roll: a seen / not-seen donut, the big roll total, and the
  // "every week" (perfect-attendance) figure.
  function renderAttendanceStats() {
    const host = $("att-stats");
    if (!host || !data || !data.stats) return;
    const s = data.stats;
    const seen = s.attending, notSeen = s.absent, total = s.members;
    const tot = seen + notSeen;
    host.textContent = "";
    const body = el("div", "statbar-body");
    const pie = el("div", "pie-wrap");
    pie.innerHTML = donutSvg(seen, notSeen);
    body.appendChild(pie);
    const fig = el("div", "statbar-figures");
    const big = el("div", "stat-big");
    big.appendChild(el("span", "stat-num", String(total)));
    big.appendChild(el("span", "stat-noun", "on the roll"));
    fig.appendChild(big);
    const legend = el("ul", "stat-legend");
    const item = (cls, label, n, pct, title) => {
      const li = el("li", "stat-item" + (cls ? "" : " stat-note"));
      if (cls) li.appendChild(el("i", "dot dot-" + cls));
      li.appendChild(el("span", "stat-label", label));
      li.appendChild(el("b", "stat-count", String(n)));
      if (pct != null) li.appendChild(el("span", "stat-pct", pct + "%"));
      if (title) li.title = title;
      return li;
    };
    legend.appendChild(item("yes", "Seen", seen, tot ? Math.round((seen / tot) * 100) : 0));
    legend.appendChild(item("no", "Not seen", notSeen, tot ? Math.round((notSeen / tot) * 100) : 0));
    legend.appendChild(item(null, "Every week", s.everyWeek, null, `Attended all ${(data.weekOptions || []).length} weeks`));
    fig.appendChild(legend);
    body.appendChild(fig);
    host.appendChild(body);
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

  // Least-squares polynomial fit. Returns coefficients c so that
  // y ≈ c[0] + c[1]t + c[2]t^2 + …, with t the week index normalised to
  // [0,1] for numerical stability. Solved via Gauss-Jordan on the normal
  // equations. No library.
  function polyfit(ys, degree) {
    const N = ys.length;
    const d = Math.min(degree, N - 1);
    const t = ys.map((_, i) => (N === 1 ? 0 : i / (N - 1)));
    const A = [], B = [];
    for (let i = 0; i <= d; i++) {
      A[i] = [];
      for (let j = 0; j <= d; j++) {
        let s = 0;
        for (let k = 0; k < N; k++) s += Math.pow(t[k], i + j);
        A[i][j] = s;
      }
      let sb = 0;
      for (let k = 0; k < N; k++) sb += ys[k] * Math.pow(t[k], i);
      B[i] = sb;
    }
    // Gauss-Jordan with partial pivoting.
    const M = A.map((row, i) => row.concat(B[i]));
    const m = d + 1;
    for (let col = 0; col < m; col++) {
      let piv = col;
      for (let r = col + 1; r < m; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      [M[col], M[piv]] = [M[piv], M[col]];
      const diag = M[col][col];
      if (Math.abs(diag) < 1e-12) continue;
      for (let r = 0; r < m; r++) {
        if (r === col) continue;
        const f = M[r][col] / diag;
        for (let k = col; k <= m; k++) M[r][k] -= f * M[col][k];
      }
    }
    return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[m] / row[i]));
  }
  const evalPoly = (c, t) => c.reduce((s, ck, k) => s + ck * Math.pow(t, k), 0);

  // ------------------------------------------------------------ line graph
  // Hand-rolled inline SVG, no chart library. The weekly count, plus a
  // polynomial (curved, not straight) least-squares trend over it. Takes a
  // per-week `present` series aligned to data.weekOptions, so the attendance
  // roll and any custom report can share the exact same chart.
  function attendanceGraphHtml(present, ariaLabel) {
    const n = present.length;
    if (!n) return "";

    const W = 1000, H = 262;
    const mL = 40, mR = 18, mT = 30, mB = 58;
    const pW = W - mL - mR, pH = H - mT - mB;

    const maxP = Math.max(...present, 1);
    const step = maxP <= 50 ? 10 : maxP <= 100 ? 25 : maxP <= 200 ? 50 : 100;
    const countMax = Math.ceil(maxP / step) * step;

    const x = (i) => (n === 1 ? mL + pW / 2 : mL + (pW * i) / (n - 1));
    const y = (v) => mT + pH * (1 - Math.max(0, Math.min(countMax, v)) / countMax);

    let grid = "";
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const val = (countMax * t) / ticks;
      const gy = y(val).toFixed(1);
      grid += `<line x1="${mL}" y1="${gy}" x2="${mL + pW}" y2="${gy}" class="g-grid"/>`;
      grid += `<text x="${mL - 7}" y="${(+gy + 3).toFixed(1)}" class="g-axis g-axis-l">${Math.round(val)}</text>`;
    }

    const countPts = present.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `<polygon class="g-area" points="${mL},${(mT + pH).toFixed(1)} ${countPts.join(" ")} ${mL + pW},${(mT + pH).toFixed(1)}"/>`;
    const countLine = `<polyline class="g-line g-line-count" points="${countPts.join(" ")}"/>`;

    // Polynomial trend: cubic when there is enough data, gentler otherwise.
    let trendLine = "";
    if (n >= 3) {
      const degree = n >= 10 ? 3 : n >= 5 ? 2 : 1;
      const c = polyfit(present, degree);
      const S = 100;
      const tp = [];
      for (let s = 0; s <= S; s++) {
        const t = s / S;
        const xi = mL + pW * t;
        const yi = y(evalPoly(c, t));
        tp.push(`${xi.toFixed(1)},${yi.toFixed(1)}`);
      }
      trendLine = `<polyline class="g-line g-line-trend" points="${tp.join(" ")}"/>`;
    }

    let dots = "";
    present.forEach((v, i) => {
      const cx = x(i).toFixed(1);
      const cy = y(v);
      dots += `<circle cx="${cx}" cy="${cy.toFixed(1)}" r="2.6" class="g-dot g-dot-count"/>`;
      dots += `<text x="${cx}" y="${(cy - 8).toFixed(1)}" class="g-val">${v}</text>`;
    });

    // Day-of-month under each point, then the month name below, grouped.
    let xdate = "";
    present.forEach((v, i) => {
      const day = data.weekOptions[i].dateDisplay.split(" ")[0];
      xdate += `<text x="${x(i).toFixed(1)}" y="${(mT + pH + 16).toFixed(1)}" class="g-date">${day}</text>`;
    });
    let xlab = "";
    for (const g of monthGroups()) {
      const a = g.indices[0], b = g.indices[g.indices.length - 1];
      const cx = ((x(a) + x(b)) / 2).toFixed(1);
      xlab += `<text x="${cx}" y="${H - 12}" class="g-month">${g.label}</text>`;
    }

    const legend =
      `<div class="g-legend">` +
      `<span class="g-key g-key-count">Present each week</span>` +
      `<span class="g-key g-key-trend">Trend (polynomial)</span>` +
      `</div>`;

    return legend +
      `<svg viewBox="0 0 ${W} ${H}" class="graph-svg" role="img" ` +
      `aria-label="${ariaLabel}">` +
      `${grid}${area}${countLine}${trendLine}${dots}${xdate}${xlab}</svg>`;
  }

  function renderGraph() {
    const box = $("graph");
    if (!box) return;
    const present = (data.weekTotals || []).map((w) => w.membersPresent);
    box.innerHTML = attendanceGraphHtml(
      present,
      `Members present per week with a polynomial trend, across ${present.length} weeks`
    );
  }

  // Per-week attendance among an arbitrary set of member records: how many
  // of `rows` attended each week. Used to draw a report-scoped version of
  // the attendance graph.
  function weeklyCountsFor(rows, nameCol) {
    const weeks = (data && data.weekOptions) ? data.weekOptions.length : 0;
    const counts = new Array(weeks).fill(0);
    if (!weeks) return counts;
    for (const r of rows) {
      const row = attendanceFor(r[nameCol]);
      if (!row || !row.cells) continue;
      for (let i = 0; i < weeks; i++) if (row.cells[i]) counts[i] += 1;
    }
    return counts;
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
        days.appendChild(el("div", "h-week", data.weekOptions[i].dateDisplay.split(" ")[0]));
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
    $("att-count").textContent = countText(rows.length, data.rows.length, "members");

    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const gone = r.total === 0;
      const row = el("div", "roll-row" + (gone ? " r-gone" : ""));

      const name = el("div", "r-name");
      name.appendChild(nameLink(r.name));
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
    renderAttendanceStats();
    renderGraph();
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

  // ------------------------------------------------------------ tabs
  let activeTab = "attendance";

  // Load the attendance roll if it isn't already in memory. Used by the
  // returned-missionaries tab so it can cross-reference participation.
  async function ensureAttendance() {
    if (data) return data;
    try {
      const s = await (await fetch("/api/state")).json();
      if (!s.hasData) return null;
      data = pruneFutureWeeks(await (await fetch("/api/data")).json());
      return data;
    } catch (_) {
      return null;
    }
  }

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tab === tab)
    );
    $("view-attendance").hidden = tab !== "attendance";
    $("view-returned").hidden = tab !== "returned";
    $("view-members").hidden = tab !== "members";
    $("view-custom").hidden = tab !== "custom";
    if (tab === "returned") {
      ensureAttendance().finally(() => ensureReturned());
    } else if (tab === "members") {
      ensureAttendance().finally(() => ensureMembers());
    } else if (tab === "custom") {
      ensureAttendance().finally(() => ensureCustom());
    }
  }

  // ------------------------------------------------------ returned missionaries
  let returned = null;
  let rmSort = loadSorts().returned || { key: "name", dir: 1 };
  let rmScope = "all";

  const RM_COLS = [
    { key: "name", label: "Preferred Name", type: "text" },
    { key: "participation", label: "Attendance", type: "text" },
    { key: "missionCountry", label: "Mission Country", type: "text" },
    { key: "missionLanguage", label: "Mission Language", type: "text" },
    { key: "age", label: "Age", type: "num" },
    { key: "trStatus", label: "Temple Recommend Status", type: "text" },
    { key: "trExpiration", label: "Temple Recommend Expiration", type: "date" },
    { key: "callings", label: "Callings", type: "text" },
  ];

  // Normalize a name for cross-report matching. The attendance roll and the
  // all-members report are both "Surname, Given" from LCR, but the exact
  // spelling can differ between them — accents, punctuation, and generational
  // suffixes ("Jr", "III") aren't written consistently. Fold all of that away
  // so the same person keys the same from either report. The transform is
  // symmetric (applied to both sides), so it only ever adds matches — which
  // is what makes the Members/Custom "attending" count line up with the
  // Attendance tab's "seen".
  const nameKey = (s) =>
    String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")    // strip accents
      .toLowerCase()
      .replace(/[.,\-]/g, " ")                              // comma/period/hyphen → space
      .replace(/[‘’'`\-]/g, "")                  // drop apostrophes/hyphens
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")             // drop generational suffixes
      .replace(/\s+/g, " ").trim();

  // Look up a returned missionary in the attendance roll. Match by name
  // against nameSort (surname-first) or name; the reports come from the
  // same LCR source so exact-normalized matching is the right test.
  function attendanceFor(rmName) {
    if (!data || !Array.isArray(data.rows)) return null;
    const key = nameKey(rmName);
    if (!key) return null;
    return data.rows.find(
      (r) => nameKey(r.nameSort) === key || nameKey(r.name) === key
    ) || null;
  }

  // ---------------------------------------------- report participation + stats
  // Shared by every list report (returned missionaries, members, custom):
  // classify a person against the attendance roll, then draw a stats widget
  // with All / Attending / Not-attending sub-tabs, a donut, and a big count.
  // Baptism date (as a YYYYMMDD number) per person, from the all-members
  // report, cached and rebuilt only when that report is replaced.
  let _baptCache = null, _baptCacheFor = null;
  function baptismMap() {
    if (!members || !members.columns) return null;
    if (_baptCacheFor === members) return _baptCache;
    const bcol = members.columns.find((c) => /bapti/i.test(c.key));
    const nameCol = memNameKey();
    const map = new Map();
    if (bcol && nameCol) {
      for (const r of (members.records || [])) {
        const d = crDate(r[bcol.key]);
        if (d != null) map.set(nameKey(r[nameCol]), d);
      }
    }
    _baptCache = map; _baptCacheFor = members;
    return map;
  }
  function baptismDateOf(name) {
    const m = baptismMap();
    const d = m ? m.get(nameKey(name)) : null;
    return d == null ? null : d;
  }

  // Attendance for one person, as "x/y z%". The denominator counts only the
  // weeks a person could have attended: weeks before their baptism date (when
  // known) don't count, so a recent convert reads 4/4 100%, not 4/20 20%.
  // "—" when they aren't on the attendance roll at all.
  function attendanceInfo(name) {
    const weekOpts = (data && data.weekOptions) || [];
    const row = attendanceFor(name);
    if (!row) return { status: "unknown", total: 0, weeks: 0, pct: 0, text: "—" };
    const cells = row.cells || [];
    const bapt = baptismDateOf(name);
    let elig = 0, attended = 0;
    for (let i = 0; i < weekOpts.length; i++) {
      if (bapt != null) {
        const wd = crDate(weekOpts[i].date);
        if (wd != null && wd < bapt) continue; // week predates baptism
      }
      elig += 1;
      if (cells[i]) attended += 1;
    }
    // If the baptism date sits after the whole span (no eligible weeks), fall
    // back to the full span rather than showing a meaningless 0/0.
    if (elig === 0) { elig = weekOpts.length; attended = row.total; }
    const pct = elig ? Math.round((attended / elig) * 100) : 0;
    // "Attending" means attended at least once in the period — the same test
    // the Attendance tab uses (row.total, the raw count) — so the two tabs'
    // seen/attending totals agree. The baptism window only shapes the x/y
    // percentage, not whether someone counts as attending.
    return { status: row.total > 0 ? "yes" : "no", total: attended, weeks: elig, pct, text: `${attended}/${elig} ${pct}%` };
  }

  function partOf(name) {
    return attendanceInfo(name).status; // "yes" | "no" | "unknown"
  }

  function attendanceBadge(name) {
    const a = attendanceInfo(name);
    return el("span", "part part-" + a.status, a.text);
  }

  // A synthetic, always-on Attendance column inserted right after the name
  // (or first, if the name isn't shown) so it never scrolls out of view and
  // can't be turned off in the custom-report column picker.
  const ATT_COL = { key: "__att", label: "Attendance", att: true };
  function withAttendanceCol(cols, nameKeyCol) {
    const i = cols.findIndex((c) => c.key === nameKeyCol);
    if (i < 0) return [ATT_COL, ...cols];
    const out = cols.slice();
    out.splice(i + 1, 0, ATT_COL);
    return out;
  }

  // Sort a set of member records by a column key. The synthetic "__att"
  // column sorts by weeks attended; text/number columns auto-detect numbers.
  function sortRows(rows, sort, nameCol) {
    if (!sort || !sort.key) return rows;
    const dir = sort.dir || 1;
    const out = rows.slice();
    if (sort.key === "__att") {
      out.sort((a, b) => dir * (attendanceInfo(a[nameCol]).total - attendanceInfo(b[nameCol]).total));
      return out;
    }
    out.sort((a, b) => {
      const av = String(a[sort.key] == null ? "" : a[sort.key]);
      const bv = String(b[sort.key] == null ? "" : b[sort.key]);
      const an = parseFloat(av), bn = parseFloat(bv);
      const bothNum = !isNaN(an) && !isNaN(bn) && /^[\d.]+$/.test(av) && /^[\d.]+$/.test(bv);
      return dir * (bothNum ? an - bn : av.localeCompare(bv));
    });
    return out;
  }

  const REPORT_SCOPES = [["all", "All"], ["attending", "Attending"], ["not", "Not attending"]];

  // Which scope tab a person belongs to. "Not attending" folds in everyone
  // who isn't attending — never-seen and not-on-the-roll alike.
  function inScope(status, scope) {
    if (scope === "attending") return status === "yes";
    if (scope === "not") return status !== "yes";
    return true;
  }

  function countStatuses(statuses) {
    let yes = 0;
    for (const s of statuses) if (s === "yes") yes += 1;
    return { yes, no: statuses.length - yes, total: statuses.length };
  }

  // Two-slice donut. Geometry is static; only the dash lengths vary.
  function donutSvg(yes, no) {
    const total = yes + no;
    const r = 42, C = 2 * Math.PI * r, sw = 16;
    const yesLen = total ? (yes / total) * C : 0;
    const noLen = total ? (no / total) * C : 0;
    const pct = total ? Math.round((yes / total) * 100) : 0;
    const arcs = total ? `
      <circle class="pie-yes" cx="50" cy="50" r="${r}" fill="none" stroke-width="${sw}"
        stroke-dasharray="${yesLen.toFixed(2)} ${(C - yesLen).toFixed(2)}" transform="rotate(-90 50 50)"/>
      <circle class="pie-no" cx="50" cy="50" r="${r}" fill="none" stroke-width="${sw}"
        stroke-dasharray="${noLen.toFixed(2)} ${(C - noLen).toFixed(2)}" stroke-dashoffset="${(-yesLen).toFixed(2)}" transform="rotate(-90 50 50)"/>` : "";
    return `<svg class="pie" viewBox="0 0 100 100" role="img" aria-label="Attending ${yes} of ${total}">
      <circle class="pie-track" cx="50" cy="50" r="${r}" fill="none" stroke-width="${sw}"/>${arcs}
      <text class="pie-center" x="50" y="50" text-anchor="middle">${total ? pct + "%" : "—"}</text>
    </svg>`;
  }

  // Render the whole widget into `host`: sub-tabs + donut + figures. `yes`/`no`
  // are the full-set split (the donut); `shown` is the count for the active
  // scope (the big number). onScope(v) switches tabs.
  function renderReportStats(host, opts) {
    const { scope, yes, no, shown, noun, onScope } = opts;
    if (!host) return;
    host.textContent = "";

    const nav = el("nav", "subtabs");
    REPORT_SCOPES.forEach(([v, label]) => {
      const b = el("button", "subtab" + (scope === v ? " is-active" : ""), label);
      b.type = "button";
      b.onclick = () => onScope(v);
      nav.appendChild(b);
    });
    host.appendChild(nav);

    const body = el("div", "statbar-body");
    const pie = el("div", "pie-wrap");
    pie.innerHTML = donutSvg(yes, no);
    body.appendChild(pie);

    const fig = el("div", "statbar-figures");
    const big = el("div", "stat-big");
    big.appendChild(el("span", "stat-num", String(shown)));
    big.appendChild(el("span", "stat-noun", noun));
    fig.appendChild(big);

    const total = yes + no;
    const legend = el("ul", "stat-legend");
    const item = (cls, tabVal, label, n) => {
      const li = el("li", "stat-item" + (scope === tabVal ? " is-active" : ""));
      li.appendChild(el("i", "dot dot-" + cls));
      li.appendChild(el("span", "stat-label", label));
      li.appendChild(el("b", "stat-count", String(n)));
      li.appendChild(el("span", "stat-pct", total ? Math.round((n / total) * 100) + "%" : "—"));
      li.onclick = () => onScope(tabVal);
      return li;
    };
    legend.appendChild(item("yes", "attending", "Attending", yes));
    legend.appendChild(item("no", "not", "Not attending", no));
    fig.appendChild(legend);
    body.appendChild(fig);
    host.appendChild(body);
  }

  async function ensureReturned() {
    if (returned) { renderReturned(); return; }
    showRmNotice("Reading the returned-missionary report from LCR…");
    try {
      const res = await fetch("/api/returned");
      if (!res.ok) {
        const { error, detail } = await res.json().catch(() => ({}));
        showRmNotice(
          error === "SESSION_EXPIRED"
            ? "Your LCR session expired. Refresh the attendance tab to sign in again."
            : detail || "Could not read the returned-missionary report."
        );
        return;
      }
      returned = await res.json();
      populateRmFilters();
      renderReturned();
      updateRmContext();
    } catch (_) {
      showRmNotice("Could not load returned-missionary data.");
    }
  }

  function showRmNotice(msg) {
    const note = $("rm-notice");
    note.hidden = false;
    note.textContent = msg;
    $("rm-table").innerHTML = "";
  }

  function updateRmContext() {
    if (returned.fetchedAt) {
      const when = new Date(returned.fetchedAt);
      $("stamp").textContent = "Pulled " + when.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
    }
    if (returned.sample) {
      $("rm-notice").hidden = false;
      $("rm-notice").textContent =
        "Sample data. The real report has not been pulled from LCR yet.";
    } else {
      $("rm-notice").hidden = true;
    }
  }

  function populateRmFilters() {
    const recs = returned.records || [];
    const fill = (id, items, allLabel) => {
      const s = $(id);
      s.innerHTML = "";
      const a = el("option", null, allLabel);
      a.value = "";
      s.appendChild(a);
      [...new Set(items.filter(Boolean))].sort().forEach((v) => {
        const o = el("option", null, v);
        o.value = v;
        s.appendChild(o);
      });
    };
    fill("rm-status", recs.map((r) => r.trStatus), "Any status");
    fill("rm-lang", recs.map((r) => r.missionLanguage), "Any language");
  }

  function rmCmp(a, b, type) {
    if (type === "num") return (Number(a) || 0) - (Number(b) || 0);
    if (type === "date") return (Date.parse(a) || 0) - (Date.parse(b) || 0);
    return String(a || "").localeCompare(String(b || ""));
  }

  // Everything except the scope sub-tab: search, status, language, sort. The
  // stats donut is computed from this set, so it shows the full split.
  function rmBase() {
    const q = $("rq").value.trim().toLowerCase();
    const status = $("rm-status").value;
    const lang = $("rm-lang").value;
    // Annotate every row with its participation, once, so filter + display
    // + sort all see the same value.
    let rows = (returned.records || []).map((r) => {
      const a = attendanceInfo(r.name);
      return Object.assign({}, r, {
        _partStatus: a.status,
        _partTotal: a.total,
        _partWeeks: a.weeks,
        participation: a.text,
      });
    });
    if (q) rows = rows.filter((r) => (r.name || "").toLowerCase().includes(q));
    if (status) rows = rows.filter((r) => r.trStatus === status);
    if (lang) rows = rows.filter((r) => r.missionLanguage === lang);
    const col = RM_COLS.find((c) => c.key === rmSort.key) || RM_COLS[0];
    // Sort participation numerically by total attended, not lexicographically
    if (rmSort.key === "participation") {
      rows.sort((a, b) => rmSort.dir * (a._partTotal - b._partTotal));
    } else {
      rows.sort((a, b) => rmSort.dir * rmCmp(a[rmSort.key], b[rmSort.key], col.type));
    }
    return rows;
  }

  function rmVisible(base) {
    return (base || rmBase()).filter((r) => inScope(r._partStatus, rmScope));
  }

  function rmStatusClass(s) {
    const t = (s || "").toLowerCase();
    if (t.includes("expired")) return "expired";
    if (t.includes("expiring")) return "expiring";
    if (t.includes("cancel")) return "canceled";
    if (t.includes("active")) return "active";
    return "none";
  }

  function renderReturned() {
    if (!returned) return;
    const table = $("rm-table");
    const base = rmBase();
    const rows = rmVisible(base);
    $("rm-empty").hidden = rows.length > 0;

    const c = countStatuses(base.map((r) => r._partStatus));
    renderReportStats($("rm-stats"), {
      scope: rmScope, yes: c.yes, no: c.no, shown: rows.length, noun: "people",
      onScope: (v) => { rmScope = v; renderReturned(); },
    });

    const thead = el("thead");
    const htr = el("tr");
    for (const c of RM_COLS) {
      const sorted = rmSort.key === c.key;
      const th = el("th", "rm-th" + (sorted ? " sorted " + (rmSort.dir > 0 ? "asc" : "desc") : ""));
      th.textContent = c.label;
      th.setAttribute("role", "button");
      th.onclick = () => {
        if (rmSort.key === c.key) rmSort.dir *= -1;
        else rmSort = { key: c.key, dir: 1 };
        saveSort("returned", rmSort);
        renderReturned();
      };
      htr.appendChild(th);
    }
    thead.appendChild(htr);

    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      for (const c of RM_COLS) {
        const td = el("td", "rm-td rm-" + c.key);
        const v = r[c.key];
        if (c.key === "name") {
          td.appendChild(nameLink(String(v || "")));
        } else if (c.key === "trStatus") {
          td.appendChild(el("span", "tr-status tr-" + rmStatusClass(v), v || "—"));
        } else if (c.key === "participation") {
          const cls = "part part-" + (r._partStatus || "unknown");
          td.appendChild(el("span", cls, v || "—"));
        } else {
          td.textContent = v == null || v === "" ? "—" : String(v);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.innerHTML = "";
    table.appendChild(thead);
    table.appendChild(tbody);
  }

  // Pull the returned-missionary report from LCR (reads its rendered table).
  async function refreshReturned() {
    const btn = $("refresh");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Reading LCR…";
    document.body.classList.add("working");
    try {
      const res = await fetch("/api/returned?force=1");
      if (res.ok) {
        returned = await res.json();
        populateRmFilters();
        renderReturned();
        updateRmContext();
      } else {
        const { error, detail } = await res.json().catch(() => ({}));
        if (error === "SESSION_EXPIRED") sessionGone();
        else showRmNotice(detail || "The report did not load. LCR may have changed its layout.");
      }
    } catch (_) {
      showRmNotice("The app stopped running. Start it again with npm start.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
      document.body.classList.remove("working");
    }
  }

  // ------------------------------------------------------------ members
  let members = null;
  let memSort = loadSorts().members || { key: null, dir: 1 };
  let memScope = "all";

  function memNameKey() {
    if (!members || !members.columns) return null;
    const c = members.columns.find((x) => /name/.test(x.key)) || members.columns[0];
    return c ? c.key : null;
  }

  // Fetch the all-members report once, without rendering. Returns the data
  // object or null. Shared by the Members tab and the profile modal.
  let membersLoad = null;
  function loadMembersData() {
    if (members) return Promise.resolve(members);
    if (membersLoad) return membersLoad;
    membersLoad = fetch("/api/members")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { members = d; return d; })
      .catch(() => null)
      .finally(() => { membersLoad = null; });
    return membersLoad;
  }

  async function ensureMembers() {
    if (members) { renderMembers(); return; }
    showMemNotice("Reading the all-members report from LCR…");
    try {
      const res = await fetch("/api/members");
      if (!res.ok) {
        const { error, detail } = await res.json().catch(() => ({}));
        showMemNotice(
          error === "SESSION_EXPIRED"
            ? "Your LCR session expired. Refresh the attendance tab to sign in again."
            : detail || "Could not read the all-members report."
        );
        return;
      }
      members = await res.json();
      renderMembers();
    } catch (_) {
      showMemNotice("Could not load the all-members report.");
    }
  }

  // ------------------------------------------------------------ profile modal
  // A clickable name anywhere opens this, filled from the all-members report
  // (the richest source). Loads that report on demand if not already in hand.
  function openProfile(name) {
    if (!name) return;
    $("profile-name").textContent = name;
    $("profile-body").innerHTML = '<p class="modal-msg">Loading…</p>';
    $("profile-modal").hidden = false;
    document.body.classList.add("modal-open");

    loadMembersData().then((m) => {
      // Guard against a race: only fill if this is still the open profile.
      if ($("profile-modal").hidden) return;
      if (!m || !m.columns) {
        $("profile-body").innerHTML =
          '<p class="modal-msg">The all-members report is not available. Open the Members tab to pull it, then try again.</p>';
        return;
      }
      const cols = m.columns;
      const nameCol = (cols.find((c) => /name/.test(c.key)) || cols[0]).key;
      const key = nameKey(name);
      const rec = (m.records || []).find((r) => nameKey(r[nameCol]) === key);
      if (!rec) {
        $("profile-body").innerHTML =
          `<p class="modal-msg">No profile found in the all-members report for “${name}”.</p>`;
        return;
      }

      // Non-empty fields first (the useful ones), then the rest as blanks.
      const body = $("profile-body");
      body.innerHTML = "";
      const dl = el("dl", "profile-grid");
      const filled = cols.filter((c) => c.key !== nameCol && String(rec[c.key] || "").trim());
      const empty = cols.filter((c) => c.key !== nameCol && !String(rec[c.key] || "").trim());
      for (const c of filled.concat(empty)) {
        const v = rec[c.key];
        const cell = el("div", "profile-field" + (String(v || "").trim() ? "" : " is-empty"));
        cell.appendChild(el("dt", null, c.label));
        cell.appendChild(el("dd", null, String(v || "").trim() || "—"));
        dl.appendChild(cell);
      }
      body.appendChild(dl);
      if (m.sample) {
        body.appendChild(el("p", "modal-msg", "Sample data — the real all-members report has not been pulled yet."));
      }
    });
  }

  function closeProfile() {
    $("profile-modal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  // Build a clickable name node.
  function nameLink(name) {
    const a = el("button", "name-link", name);
    a.type = "button";
    a.title = "View member profile";
    a.addEventListener("click", (e) => { e.stopPropagation(); openProfile(name); });
    return a;
  }

  function showMemNotice(msg) {
    const note = $("mem-notice");
    note.hidden = false;
    note.textContent = msg;
    $("mem-table").innerHTML = "";
  }

  // Search + sort, but not the scope sub-tab (the donut needs the full split).
  function memBase() {
    const q = $("mq").value.trim().toLowerCase();
    const nameKeyCol = memNameKey();
    let rows = (members.records || []).slice();
    if (q && nameKeyCol) {
      rows = rows.filter((r) => String(r[nameKeyCol] || "").toLowerCase().includes(q));
    }
    return sortRows(rows, memSort, nameKeyCol);
  }

  function memVisible(base) {
    const rows = base || memBase();
    const nameCol = memNameKey();
    return rows.filter((r) => inScope(partOf(r[nameCol]), memScope));
  }

  // Reconciliation: the Attendance tab's "seen" count and this tab's
  // "attending" count can only tie out if every attending person on the
  // roll is also in the all-members report. Surface the ones that aren't,
  // so a residual gap is explained (and shows whether it's a name mismatch
  // or a person genuinely missing from the export) rather than mysterious.
  function renderMemRecon(nameCol) {
    const recon = $("mem-recon");
    if (!recon) return;
    if (!data || !Array.isArray(data.rows) || !nameCol) { recon.hidden = true; return; }
    const memKeys = new Set((members.records || []).map((r) => nameKey(r[nameCol])));
    const seen = data.rows.filter((r) => r.total > 0);
    const missing = seen.filter((r) => !memKeys.has(nameKey(r.nameSort)) && !memKeys.has(nameKey(r.name)));
    if (!missing.length) { recon.hidden = true; return; }
    recon.hidden = false;
    const names = missing.slice(0, 25).map((r) => r.name).join("; ");
    recon.textContent =
      `${seen.length} seen on the attendance roll; ${seen.length - missing.length} of them are in this report. ` +
      `${missing.length} attending ${missing.length === 1 ? "person isn't" : "people aren't"} in the all-members ` +
      `report, so they can't be counted here: ${names}${missing.length > 25 ? " …" : ""}`;
    console.warn("[LCR Pro] Attending on the roll but not matched in the all-members report:", missing.map((r) => r.name));
  }

  function renderMembers() {
    if (!members) return;
    const cols = members.columns || [];
    const table = $("mem-table");
    const base = memBase();
    const rows = memVisible(base);
    $("mem-empty").hidden = rows.length > 0;

    const nameCol = memNameKey();
    const c = countStatuses(base.map((r) => partOf(r[nameCol])));
    renderReportStats($("mem-stats"), {
      scope: memScope, yes: c.yes, no: c.no, shown: rows.length, noun: "people",
      onScope: (v) => { memScope = v; renderMembers(); },
    });
    renderMemRecon(nameCol);
    if (members.fetchedAt) {
      const when = new Date(members.fetchedAt);
      $("stamp").textContent = "Pulled " + when.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
    }
    if (members.sample) {
      $("mem-notice").hidden = false;
      $("mem-notice").textContent =
        "Sample data. The real all-members report has not been pulled from LCR yet.";
    } else {
      $("mem-notice").hidden = true;
    }

    const nameColKey = memNameKey();
    const displayCols = withAttendanceCol(cols, nameColKey);

    const thead = el("thead");
    const htr = el("tr");
    for (const c of displayCols) {
      const sorted = memSort.key === c.key;
      const th = el("th", "rm-th" + (c.att ? " att-th" : "") + (sorted ? " sorted " + (memSort.dir > 0 ? "asc" : "desc") : ""));
      th.textContent = c.label;
      th.setAttribute("role", "button");
      th.onclick = () => {
        if (memSort.key === c.key) memSort.dir *= -1;
        else memSort = { key: c.key, dir: 1 };
        saveSort("members", memSort);
        renderMembers();
      };
      htr.appendChild(th);
    }
    thead.appendChild(htr);

    const tbody = el("tbody");
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const tr = el("tr");
      for (const c of displayCols) {
        if (c.att) {
          const td = el("td", "mem-td att-td");
          td.appendChild(attendanceBadge(r[nameColKey]));
          tr.appendChild(td);
          continue;
        }
        const v = r[c.key];
        if (c.key === nameColKey && String(v || "").trim()) {
          const td = el("td", "mem-td");
          td.appendChild(nameLink(String(v)));
          tr.appendChild(td);
        } else {
          tr.appendChild(el("td", "mem-td", v == null || v === "" ? "—" : String(v)));
        }
      }
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);

    table.innerHTML = "";
    table.appendChild(thead);
    table.appendChild(tbody);
  }

  // ------------------------------------------------------------ custom reports
  // A client-side query builder over the all-members report. Operators are
  // context-aware (numbers get >/<, dates get before/after, yes-no gets a
  // picker), and filters live in groups so AND and OR can mix:
  //   (group A: all of…) OR (group B: any of…)
  const CR_OPS = {
    text: [
      { v: "contains", label: "contains" },
      { v: "is", label: "is" },
      { v: "is_not", label: "is not" },
      { v: "starts", label: "starts with" },
      { v: "empty", label: "is empty", noVal: true },
      { v: "not_empty", label: "is not empty", noVal: true },
    ],
    number: [
      { v: "eq", label: "=" },
      { v: "neq", label: "≠" },
      { v: "gt", label: "greater than" },
      { v: "gte", label: "at least (≥)" },
      { v: "lt", label: "less than" },
      { v: "lte", label: "at most (≤)" },
      { v: "empty", label: "is empty", noVal: true },
      { v: "not_empty", label: "is not empty", noVal: true },
    ],
    date: [
      { v: "d_on", label: "on" },
      { v: "d_before", label: "before" },
      { v: "d_after", label: "after" },
      { v: "d_onbefore", label: "on or before" },
      { v: "d_onafter", label: "on or after" },
      { v: "empty", label: "is empty", noVal: true },
      { v: "not_empty", label: "is not empty", noVal: true },
    ],
    boolean: [
      { v: "is", label: "is" },
      { v: "is_not", label: "is not" },
      { v: "empty", label: "is empty", noVal: true },
      { v: "not_empty", label: "is not empty", noVal: true },
    ],
  };
  const CR_LS_KEY = "kalayaan:customReports";
  let crState = { groupsMatch: "all", groups: [], columns: [] };
  let crScope = "all";
  let crSort = loadSorts().custom || { key: null, dir: 1 };
  let crDragKey = null;   // column being dragged in the custom table header
  let crDragged = false;  // suppress the sort click that ends a drag
  let crReady = false;
  let crTypes = {}; // column key -> "text" | "number" | "date" | "boolean"

  // Infer a column's type from a sample of its values.
  function crInferType(key) {
    const recs = (members && members.records) || [];
    let n = 0, num = 0, date = 0, bool = 0;
    for (const r of recs) {
      const v = String(r[key] == null ? "" : r[key]).trim();
      if (!v) continue;
      n += 1;
      if (n > 80) break;
      if (/^-?\d+(\.\d+)?$/.test(v)) num += 1;
      if (/^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/.test(v)) date += 1;
      if (/^(yes|no|true|false)$/i.test(v)) bool += 1;
    }
    if (!n) return "text";
    if (num / n > 0.9) return "number";
    if (bool / n > 0.9) return "boolean";
    if (date / n > 0.8) return "date";
    return "text";
  }

  function crDistinct(key) {
    const set = new Set();
    for (const r of (members.records || [])) {
      const v = String(r[key] == null ? "" : r[key]).trim();
      if (v) set.add(v);
      if (set.size > 60) break;
    }
    return [...set].sort();
  }

  // Day number YYYYMMDD for date comparison. Handles both LCR's "30 Apr
  // 2027" cells and the date input's "2027-04-30" (parsed without timezone
  // drift for the ISO form).
  function crDate(s) {
    if (!s) return null;
    s = String(s).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) return +iso[1] * 10000 + +iso[2] * 100 + +iso[3];
    const t = Date.parse(s);
    if (isNaN(t)) return null;
    const d = new Date(t);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function crOpsFor(type) { return CR_OPS[type] || CR_OPS.text; }
  function crOpDef(op, type) { return crOpsFor(type).find((o) => o.v === op); }

  function crEval(raw, op, val, type) {
    const cell = String(raw == null ? "" : raw).trim();
    if (op === "empty") return cell === "";
    if (op === "not_empty") return cell !== "";
    if (type === "number") {
      const a = parseFloat(cell), b = parseFloat(val);
      if (isNaN(a) || isNaN(b)) return false;
      switch (op) {
        case "eq": return a === b;
        case "neq": return a !== b;
        case "gt": return a > b;
        case "gte": return a >= b;
        case "lt": return a < b;
        case "lte": return a <= b;
        default: return false;
      }
    }
    if (type === "date") {
      const a = crDate(cell), b = crDate(val);
      if (a == null || b == null) return false;
      switch (op) {
        case "d_on": return a === b;
        case "d_before": return a < b;
        case "d_after": return a > b;
        case "d_onbefore": return a <= b;
        case "d_onafter": return a >= b;
        default: return false;
      }
    }
    const c = cell.toLowerCase();
    const v = String(val == null ? "" : val).trim().toLowerCase();
    switch (op) {
      case "contains": return c.includes(v);
      case "is": return c === v;
      case "is_not": return c !== v;
      case "starts": return c.startsWith(v);
      default: return true;
    }
  }

  function crGroupMatches(group, rec) {
    const active = group.filters.filter((f) => f.field && f.op);
    if (!active.length) return null; // neutral: no constraint
    const hits = active.map((f) => crEval(rec[f.field], f.op, f.value, crTypes[f.field] || "text"));
    return group.match === "any" ? hits.some(Boolean) : hits.every(Boolean);
  }

  function crVisible() {
    const recs = (members && members.records) || [];
    const groupResults = (rec) => crState.groups.map((g) => crGroupMatches(g, rec)).filter((x) => x !== null);
    return recs.filter((rec) => {
      const rs = groupResults(rec);
      if (!rs.length) return true; // no active filters anywhere
      return crState.groupsMatch === "any" ? rs.some(Boolean) : rs.every(Boolean);
    });
  }

  // Query-matched rows narrowed by the name search and sorted — everything
  // except the scope sub-tab. The stats donut and the table both build on it.
  function crBaseRows() {
    const nameColKey = (members.columns.find((c) => /name/.test(c.key)) || {}).key;
    const q = ($("cq").value || "").trim().toLowerCase();
    let rows = crVisible();
    if (q && nameColKey) rows = rows.filter((r) => String(r[nameColKey] || "").toLowerCase().includes(q));
    return sortRows(rows, crSort, nameColKey);
  }

  function crNewFilter() {
    const cols = (members && members.columns) || [];
    const field = cols[0] ? cols[0].key : "";
    const type = crTypes[field] || "text";
    return { field, op: crOpsFor(type)[0].v, value: "" };
  }

  function crInit() {
    if (crReady || !members) return;
    const cols = members.columns || [];
    crTypes = {};
    for (const c of cols) crTypes[c.key] = crInferType(c.key);
    const nameCol = (cols.find((c) => /name/.test(c.key)) || cols[0] || {}).key;
    const defaults = [];
    if (nameCol) defaults.push(nameCol);
    for (const c of cols) { if (defaults.length >= 6) break; if (!defaults.includes(c.key)) defaults.push(c.key); }
    crState = { groupsMatch: "all", groups: [{ match: "all", filters: [] }], columns: defaults };
    crReady = true;
  }

  function showCrNotice(msg) {
    const note = $("cr-notice");
    note.hidden = false;
    note.textContent = msg;
    $("cr-table").innerHTML = "";
  }

  async function ensureCustom() {
    const m = await loadMembersData();
    if (!m || !m.columns) {
      showCrNotice("The all-members report is not available. Open the Members tab to pull it, then come back.");
      return;
    }
    if (m.sample) { $("cr-notice").hidden = false; $("cr-notice").textContent = "Sample data — the real all-members report has not been pulled yet."; }
    else { $("cr-notice").hidden = true; }
    crInit();
    $("cr-name").value = crActiveName || "";
    $("cr-match").value = crState.groupsMatch;
    crSetEditing(false);
    renderCrSidebar();
    renderCrGroups();
    renderCrColumns();
    renderCrTable();
  }

  // One filter row: [field] [operator] [value] [remove].
  function crFilterRow(group, f) {
    const row = el("div", "cr-filter");

    const fsel = el("select", "cr-f-field");
    for (const c of members.columns) {
      const o = el("option", null, c.label); o.value = c.key;
      if (c.key === f.field) o.selected = true;
      fsel.appendChild(o);
    }
    fsel.onchange = () => {
      f.field = fsel.value;
      const t = crTypes[f.field] || "text";
      if (!crOpDef(f.op, t)) f.op = crOpsFor(t)[0].v; // keep op valid for the new type
      f.value = "";
      renderCrGroups(); renderCrTable();
    };

    const type = crTypes[f.field] || "text";
    const osel = el("select", "cr-f-op");
    for (const op of crOpsFor(type)) {
      const o = el("option", null, op.label); o.value = op.v;
      if (op.v === f.op) o.selected = true;
      osel.appendChild(o);
    }
    osel.onchange = () => { f.op = osel.value; renderCrGroups(); renderCrTable(); };

    row.append(fsel, osel, crValueInput(f, type));

    const rm = el("button", "cr-f-remove"); rm.type = "button"; rm.textContent = "×"; rm.title = "Remove condition";
    rm.onclick = () => {
      group.filters.splice(group.filters.indexOf(f), 1);
      renderCrGroups(); renderCrTable();
    };
    row.appendChild(rm);
    return row;
  }

  function crValueInput(f, type) {
    const def = crOpDef(f.op, type);
    if (def && def.noVal) {
      const sp = el("span", "cr-f-val"); sp.style.visibility = "hidden"; return sp;
    }
    if (type === "boolean") {
      const sel = el("select", "cr-f-val");
      const vals = crDistinct(f.field);
      (vals.length ? vals : ["Yes", "No"]).forEach((v) => {
        const o = el("option", null, v); o.value = v; if (String(f.value) === v) o.selected = true; sel.appendChild(o);
      });
      if (!f.value && sel.options.length) f.value = sel.value;
      sel.onchange = () => { f.value = sel.value; renderCrTable(); };
      return sel;
    }
    const inp = el("input", "cr-f-val");
    inp.type = type === "number" ? "number" : type === "date" ? "date" : "text";
    inp.value = f.value || "";
    inp.placeholder = "value";
    let vt;
    inp.oninput = () => { f.value = inp.value; clearTimeout(vt); vt = setTimeout(renderCrTable, 120); };
    inp.onchange = () => { f.value = inp.value; renderCrTable(); };
    return inp;
  }

  const CR_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function crHumanDate(s) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? "" : s).trim());
    if (!iso) return String(s == null ? "" : s).trim();
    return `${+iso[3]} ${CR_MONTHS[+iso[2] - 1]} ${iso[1]}`;
  }

  // A single condition, phrased for a reader instead of as field/op/value.
  function crHumanFilter(f) {
    const col = (members.columns || []).find((c) => c.key === f.field);
    const label = col ? col.label : f.field;
    const low = String(label).toLowerCase();
    const type = crTypes[f.field] || "text";
    const v = f.value;
    if (f.op === "empty") return `${low} is blank`;
    if (f.op === "not_empty") return `${low} is present`;
    if (type === "number") {
      const m = { eq: "is", neq: "is not", gt: "is over", gte: "is at least", lt: "is under", lte: "is at most" };
      return `${low} ${m[f.op] || f.op} ${v}`;
    }
    if (type === "date") {
      const m = { d_on: "is on", d_before: "is before", d_after: "is after", d_onbefore: "is on or before", d_onafter: "is on or after" };
      return `${low} ${m[f.op] || f.op} ${crHumanDate(v)}`;
    }
    if (type === "boolean") {
      const base = String(label).replace(/^is\s+/i, "").toLowerCase();
      const yes = /^(yes|true|1)$/i.test(String(v));
      const positive = (f.op === "is" && yes) || (f.op === "is_not" && !yes);
      return (positive ? "" : "not ") + base;
    }
    const m = { contains: "contains", is: "is", is_not: "is not", starts: "starts with" };
    return `${low} ${m[f.op] || f.op} “${v}”`;
  }

  function crHumanGroup(g) {
    const active = g.filters.filter((f) => f.field && f.op);
    if (!active.length) return null;
    return active.map(crHumanFilter).join(g.match === "any" ? " or " : " and ");
  }

  // The whole query as one sentence: "Members where age is at least 18 and
  // not married." An empty query reads as everyone.
  function crSummaryText() {
    if (!members) return "";
    const groups = crState.groups.map(crHumanGroup).filter(Boolean);
    if (!groups.length) return "All members — no filters applied.";
    const joiner = crState.groupsMatch === "any" ? " OR " : " and ";
    const parts = groups.length > 1
      ? groups.map((g) => (/ and | or /.test(g) ? `(${g})` : g))
      : groups;
    return "Members where " + parts.join(joiner) + ".";
  }

  function renderCrSummary() {
    const s = $("cr-summary");
    if (s) s.textContent = crSummaryText();
  }

  // Collapsed by default: a reader-friendly summary with an Edit button.
  // Editing reveals the group builder and the Save button.
  const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  let crEditing = false;
  function crSetEditing(on) {
    crEditing = on;
    $("cr-edit-panel").hidden = !on;
    $("cr-summary").hidden = on;
    $("cr-save").hidden = !on;
    // The edit toggle becomes a check ("done") while editing.
    const edit = $("cr-edit");
    edit.innerHTML = on ? ICON_CHECK : ICON_PENCIL;
    edit.title = on ? "Done editing" : "Edit";
    edit.setAttribute("aria-label", on ? "Done editing" : "Edit");
    edit.classList.toggle("is-active", on);
    if (!on) { $("cr-columns").hidden = true; renderCrSummary(); }
  }

  function renderCrGroups() {
    const box = $("cr-filters");
    box.textContent = "";
    if (!members) return;
    crState.groups.forEach((g, gi) => {
      const card = el("div", "cr-group");
      const head = el("div", "cr-group-head");
      head.appendChild(el("span", "cr-group-lab", "Match"));
      const gm = el("select", "cr-group-match");
      [["all", "all of (AND)"], ["any", "any of (OR)"]].forEach(([v, t]) => {
        const o = el("option", null, t); o.value = v; if (g.match === v) o.selected = true; gm.appendChild(o);
      });
      gm.onchange = () => { g.match = gm.value; renderCrTable(); };
      head.appendChild(gm);
      const addc = el("button", "cr-linkbtn", "+ condition"); addc.type = "button";
      addc.onclick = () => { g.filters.push(crNewFilter()); renderCrGroups(); renderCrTable(); };
      head.appendChild(addc);
      if (crState.groups.length > 1) {
        const rmg = el("button", "cr-linkbtn", "remove group"); rmg.type = "button";
        rmg.onclick = () => { crState.groups.splice(gi, 1); renderCrGroups(); renderCrTable(); };
        head.appendChild(rmg);
      }
      card.appendChild(head);
      if (!g.filters.length) card.appendChild(el("p", "cr-hint", "No conditions yet — add one, or this group matches everyone."));
      g.filters.forEach((f) => card.appendChild(crFilterRow(g, f)));
      box.appendChild(card);
      if (gi < crState.groups.length - 1) {
        box.appendChild(el("div", "cr-group-conn", crState.groupsMatch === "all" ? "AND" : "OR"));
      }
    });
  }

  function renderCrColumns() {
    const box = $("cr-columns");
    box.textContent = "";
    if (!members) return;
    const bar = el("div", "cr-col-actions");
    const all = el("button", "cr-linkbtn", "Select all"); all.type = "button";
    all.onclick = () => { crState.columns = members.columns.map((c) => c.key); renderCrColumns(); renderCrTable(); };
    const none = el("button", "cr-linkbtn", "Clear"); none.type = "button";
    none.onclick = () => { crState.columns = []; renderCrColumns(); renderCrTable(); };
    bar.append(all, none);
    box.appendChild(bar);
    const grid = el("div", "cr-col-grid");
    for (const c of members.columns) {
      const lab = el("label", "cr-col");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = crState.columns.includes(c.key);
      cb.onchange = () => {
        if (cb.checked) { if (!crState.columns.includes(c.key)) crState.columns.push(c.key); }
        else { crState.columns = crState.columns.filter((k) => k !== c.key); }
        renderCrTable();
      };
      lab.append(cb, document.createTextNode(" " + c.label));
      grid.appendChild(lab);
    }
    box.appendChild(grid);
  }

  function renderCrTable() {
    if (!members) return;
    // Display columns follow crState.columns ORDER (the user's arrangement),
    // not the source report's fixed order.
    const byKey = new Map((members.columns || []).map((c) => [c.key, c]));
    const cols = crState.columns.map((k) => byKey.get(k)).filter(Boolean);
    const nameColKey = (members.columns.find((c) => /name/.test(c.key)) || {}).key;
    const base = crBaseRows(); // query + name search + sort, before the scope tab
    const rows = base.filter((r) => inScope(partOf(r[nameColKey]), crScope));
    renderCrSummary();

    const c = countStatuses(base.map((r) => partOf(r[nameColKey])));
    renderReportStats($("cr-stats"), {
      scope: crScope, yes: c.yes, no: c.no, shown: rows.length, noun: "members",
      onScope: (v) => { crScope = v; renderCrTable(); },
    });

    // Weekly attendance graph for just this report's members, same style as
    // the attendance tab.
    const g = $("cr-graph");
    if (g) g.innerHTML = attendanceGraphHtml(
      weeklyCountsFor(base, nameColKey),
      "Report members present per week, with a polynomial trend"
    );

    $("cr-empty").hidden = rows.length > 0;
    const table = $("cr-table");
    const displayCols = withAttendanceCol(cols, nameColKey);

    const thead = el("thead");
    const htr = el("tr");
    for (const c of displayCols) {
      const sorted = crSort.key === c.key;
      const th = el("th", "rm-th" + (c.att ? " att-th" : " cr-th-move") + (sorted ? " sorted " + (crSort.dir > 0 ? "asc" : "desc") : ""), c.label);
      th.setAttribute("role", "button");
      th.onclick = () => {
        if (crDragged) return; // a drag just ended on this header; don't sort
        if (crSort.key === c.key) crSort.dir *= -1;
        else crSort = { key: c.key, dir: 1 };
        saveSort("custom", crSort);
        renderCrTable();
      };
      // The synthetic Attendance column is pinned; every real column can be
      // dragged onto another to rearrange the order.
      if (!c.att) {
        th.draggable = true;
        th.addEventListener("dragstart", (e) => {
          crDragKey = c.key; crDragged = false;
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", c.key); } catch (_) {}
          th.classList.add("dragging");
        });
        th.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; th.classList.add("drop-target"); });
        th.addEventListener("dragleave", () => th.classList.remove("drop-target"));
        th.addEventListener("drop", (e) => {
          e.preventDefault();
          th.classList.remove("drop-target");
          crDragged = true;
          crReorderColumns(crDragKey, c.key);
        });
        th.addEventListener("dragend", () => {
          th.classList.remove("dragging");
          // Clear the suppress flag after the click that follows the drop.
          setTimeout(() => { crDragged = false; }, 0);
        });
      }
      htr.appendChild(th);
    }
    thead.appendChild(htr);

    const tbody = el("tbody");
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const tr = el("tr");
      for (const c of displayCols) {
        if (c.att) {
          const td = el("td", "mem-td att-td"); td.appendChild(attendanceBadge(r[nameColKey])); tr.appendChild(td);
          continue;
        }
        const v = r[c.key];
        if (c.key === nameColKey && String(v || "").trim()) {
          const td = el("td", "mem-td"); td.appendChild(nameLink(String(v))); tr.appendChild(td);
        } else {
          tr.appendChild(el("td", "mem-td", v == null || v === "" ? "—" : String(v)));
        }
      }
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    table.innerHTML = "";
    table.appendChild(thead);
    table.appendChild(tbody);
  }

  function crDownloadCsv() {
    if (!members) return;
    const byKey = new Map((members.columns || []).map((c) => [c.key, c]));
    const cols = crState.columns.map((k) => byKey.get(k)).filter(Boolean);
    const nameColKey = (members.columns.find((c) => /name/.test(c.key)) || {}).key;
    const displayCols = withAttendanceCol(cols, nameColKey);
    const rows = crBaseRows().filter((r) => inScope(partOf(r[nameColKey]), crScope));
    const esc = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cell = (c, r) => (c.att ? attendanceInfo(r[nameColKey]).text : r[c.key]);
    const lines = [displayCols.map((c) => esc(c.label)).join(",")];
    for (const r of rows) lines.push(displayCols.map((c) => esc(cell(c, r))).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "custom-report.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function crLoadSaved() {
    try { return JSON.parse(localStorage.getItem(CR_LS_KEY) || "{}"); } catch (_) { return {}; }
  }

  let crActiveName = null;

  function renderCrSidebar() {
    const saved = crLoadSaved();
    const list = $("cr-list");
    list.textContent = "";
    const names = Object.keys(saved).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      list.appendChild(el("li", "cr-list-empty", "No saved reports yet. Build one and Save."));
      return;
    }
    for (const name of names) {
      const li = el("li", "cr-list-item" + (name === crActiveName ? " is-active" : ""));
      const open = el("button", "cr-list-name", name);
      open.type = "button";
      open.onclick = () => crLoad(name);
      const del = el("button", "cr-list-del", "×");
      del.type = "button"; del.title = "Delete report";
      del.onclick = (e) => { e.stopPropagation(); crDeleteName(name); };
      li.append(open, del);
      list.appendChild(li);
    }
  }

  function crLoad(name) {
    const saved = crLoadSaved();
    const r = saved[name];
    if (!r) return;
    const groups = r.groups
      ? r.groups.map((g) => ({ match: g.match || "all", filters: (g.filters || []).map((f) => ({ ...f })) }))
      : [{ match: r.match || "all", filters: (r.filters || []).map((f) => ({ ...f })) }];
    crState = {
      groupsMatch: r.groupsMatch || "all",
      groups: groups.length ? groups : [{ match: "all", filters: [] }],
      columns: (r.columns || []).slice(),
    };
    crActiveName = name;
    crScope = "all";
    $("cr-name").value = name;
    $("cq").value = "";
    $("cr-match").value = crState.groupsMatch;
    crSetEditing(false);
    renderCrSidebar(); renderCrGroups(); renderCrColumns(); renderCrTable();
  }

  function crSaveCurrent() {
    let name = ($("cr-name").value || "").trim();
    if (!name) {
      $("cr-name").focus();
      $("cr-name").placeholder = "Name the report first…";
      return;
    }
    const saved = crLoadSaved();
    // Renaming an active report: drop the old key.
    if (crActiveName && crActiveName !== name) delete saved[crActiveName];
    saved[name] = { groupsMatch: crState.groupsMatch, groups: crState.groups, columns: crState.columns };
    localStorage.setItem(CR_LS_KEY, JSON.stringify(saved));
    crActiveName = name;
    renderCrSidebar();
    crSetEditing(false);
  }

  // A distinct "<base> copy" name that doesn't collide with an existing one.
  function crCopyName(base) {
    const saved = crLoadSaved();
    let name = `${base} copy`;
    let i = 2;
    while (saved[name]) name = `${base} copy ${i++}`;
    return name;
  }

  // Clone crState so the copy and the original never share nested objects.
  function crCloneState() {
    return {
      groupsMatch: crState.groupsMatch,
      groups: crState.groups.map((g) => ({ match: g.match, filters: g.filters.map((f) => ({ ...f })) })),
      columns: crState.columns.slice(),
    };
  }

  // Write the working state back onto the active saved report, so a change
  // like a column re-arrangement persists across sessions without a Save.
  function crPersistActive() {
    if (!crActiveName) return;
    const saved = crLoadSaved();
    if (!saved[crActiveName]) return;
    saved[crActiveName] = crCloneState();
    try { localStorage.setItem(CR_LS_KEY, JSON.stringify(saved)); } catch (_) {}
  }

  // Move column `fromKey` to sit where `toKey` is (drag-to-rearrange).
  function crReorderColumns(fromKey, toKey) {
    if (!fromKey || fromKey === toKey) return;
    const cols = crState.columns.slice();
    const fi = cols.indexOf(fromKey);
    if (fi < 0) return;
    cols.splice(fi, 1);
    const ti = cols.indexOf(toKey);
    cols.splice(ti < 0 ? cols.length : ti, 0, fromKey);
    crState.columns = cols;
    crPersistActive();
    renderCrColumns();
    renderCrTable();
  }

  // Duplicate the current report as a new saved copy, and make it active.
  function crDuplicate() {
    if (!members) return;
    const base = crActiveName || ($("cr-name").value || "").trim() || "Untitled report";
    const name = crCopyName(base);
    const saved = crLoadSaved();
    saved[name] = crCloneState();
    localStorage.setItem(CR_LS_KEY, JSON.stringify(saved));
    crState = crCloneState();
    crActiveName = name;
    $("cr-name").value = name;
    crSetEditing(false);
    renderCrSidebar(); renderCrGroups(); renderCrColumns(); renderCrTable();
  }

  function crNew() {
    const cols = (members && members.columns) || [];
    const nameCol = (cols.find((c) => /name/.test(c.key)) || cols[0] || {}).key;
    const defaults = [];
    if (nameCol) defaults.push(nameCol);
    for (const c of cols) { if (defaults.length >= 6) break; if (!defaults.includes(c.key)) defaults.push(c.key); }
    crState = { groupsMatch: "all", groups: [{ match: "all", filters: [] }], columns: defaults };
    crActiveName = null;
    crScope = "all";
    $("cr-name").value = "";
    $("cq").value = "";
    $("cr-match").value = "all";
    renderCrSidebar(); renderCrGroups(); renderCrColumns(); renderCrTable();
    crSetEditing(true); // a fresh report opens ready to build
    $("cr-name").focus();
  }

  function crDeleteName(name) {
    if (!confirm(`Delete saved report \u201c${name}\u201d?`)) return;
    const saved = crLoadSaved();
    delete saved[name];
    localStorage.setItem(CR_LS_KEY, JSON.stringify(saved));
    if (crActiveName === name) { crActiveName = null; $("cr-name").value = ""; }
    renderCrSidebar();
  }


  // ------------------------------------------------------------ wiring
  let t;
  const debounce = () => { clearTimeout(t); t = setTimeout(renderBody, 120); };
  $("q").addEventListener("input", debounce);
  $("org").addEventListener("change", renderBody);
  // Restore the saved roll order, then persist it on change.
  {
    const savedOrder = loadSorts().attendance;
    if (savedOrder && [...$("sort").options].some((o) => o.value === savedOrder)) {
      $("sort").value = savedOrder;
    }
  }
  $("sort").addEventListener("change", () => { saveSort("attendance", $("sort").value); renderBody(); });
  $("hide-absent").addEventListener("change", renderBody);
  $("refresh").addEventListener("click", () =>
    activeTab === "returned" ? refreshReturned() : refresh()
  );
  $("export").addEventListener("click", (e) => {
    e.currentTarget.href = $("hide-absent").checked
      ? "/api/export.csv?scope=attended"
      : "/api/export.csv";
  });
  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tab))
  );
  $("cr-match").addEventListener("change", () => { crState.groupsMatch = $("cr-match").value; renderCrGroups(); renderCrTable(); });
  $("cr-add-filter").addEventListener("click", () => {
    crState.groups.push({ match: "all", filters: [crNewFilter()] });
    renderCrGroups(); renderCrTable();
  });
  $("cr-columns-btn").addEventListener("click", () => { $("cr-columns").hidden = !$("cr-columns").hidden; });
  $("cr-edit").addEventListener("click", () => crSetEditing(!crEditing));
  $("cr-save").addEventListener("click", crSaveCurrent);
  $("cr-duplicate").addEventListener("click", crDuplicate);
  $("cr-new").addEventListener("click", crNew);
  $("cr-name").addEventListener("keydown", (e) => { if (e.key === "Enter") crSaveCurrent(); });
  $("cr-export").addEventListener("click", (e) => { e.preventDefault(); crDownloadCsv(); });
  $("profile-close").addEventListener("click", closeProfile);
  $("profile-backdrop").addEventListener("click", closeProfile);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("profile-modal").hidden) closeProfile();
  });
  let rt;
  $("rq").addEventListener("input", () => { clearTimeout(rt); rt = setTimeout(renderReturned, 120); });
  $("rm-status").addEventListener("change", renderReturned);
  $("rm-lang").addEventListener("change", renderReturned);
  let mt;
  $("mq").addEventListener("input", () => { clearTimeout(mt); mt = setTimeout(renderMembers, 120); });
  let ct;
  $("cq").addEventListener("input", () => { clearTimeout(ct); ct = setTimeout(renderCrTable, 120); });

  boot();
})();
