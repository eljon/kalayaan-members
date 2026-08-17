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
    $("tabs").hidden = false;
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
  // polynomial (curved, not straight) least-squares trend over it.
  function renderGraph() {
    const box = $("graph");
    if (!box) return;
    const wt = data.weekTotals || [];
    const n = wt.length;
    if (!n) { box.innerHTML = ""; return; }

    const W = 1000, H = 262;
    const mL = 40, mR = 18, mT = 30, mB = 58;
    const pW = W - mL - mR, pH = H - mT - mB;

    const present = wt.map((w) => w.membersPresent);
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

    box.innerHTML =
      legend +
      `<svg viewBox="0 0 ${W} ${H}" class="graph-svg" role="img" ` +
      `aria-label="Members present per week with a polynomial trend, across ${n} weeks">` +
      `${grid}${area}${countLine}${trendLine}${dots}${xdate}${xlab}</svg>`;
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

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tab === tab)
    );
    $("view-attendance").hidden = tab !== "attendance";
    $("view-returned").hidden = tab !== "returned";
    $("app-title").textContent =
      tab === "returned" ? "Returned Missionaries" : "Attendance Roll";
    if (tab === "returned") {
      $("stats-line").hidden = true;
      ensureReturned();
    } else {
      $("stats-line").hidden = false;
      if (data) renderMasthead();
    }
  }

  // ------------------------------------------------------ returned missionaries
  let returned = null;
  let rmSort = { key: "name", dir: 1 };

  const RM_COLS = [
    { key: "name", label: "Preferred Name", type: "text" },
    { key: "missionCountry", label: "Mission Country", type: "text" },
    { key: "missionLanguage", label: "Mission Language", type: "text" },
    { key: "age", label: "Age", type: "num" },
    { key: "trStatus", label: "Temple Recommend Status", type: "text" },
    { key: "trExpiration", label: "Temple Recommend Expiration", type: "date" },
    { key: "callings", label: "Callings", type: "text" },
  ];

  async function ensureReturned() {
    if (returned) { renderReturned(); return; }
    try {
      const res = await fetch("/api/returned");
      if (!res.ok) {
        showRmNotice("No returned-missionary data pulled from LCR yet.");
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
    const n = (returned.records || []).length;
    $("unit-line").textContent = `Returned missionaries · ${n} people`;
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

  function rmVisible() {
    const q = $("rq").value.trim().toLowerCase();
    const status = $("rm-status").value;
    const lang = $("rm-lang").value;
    let rows = (returned.records || []).slice();
    if (q) rows = rows.filter((r) => (r.name || "").toLowerCase().includes(q));
    if (status) rows = rows.filter((r) => r.trStatus === status);
    if (lang) rows = rows.filter((r) => r.missionLanguage === lang);
    const col = RM_COLS.find((c) => c.key === rmSort.key) || RM_COLS[0];
    rows.sort((a, b) => rmSort.dir * rmCmp(a[rmSort.key], b[rmSort.key], col.type));
    return rows;
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
    const rows = rmVisible();
    $("rm-empty").hidden = rows.length > 0;

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
        if (c.key === "trStatus") {
          td.appendChild(el("span", "tr-status tr-" + rmStatusClass(v), v || "—"));
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

  async function refreshReturned() {
    returned = null;
    await ensureReturned();
  }

  // ------------------------------------------------------------ wiring
  let t;
  const debounce = () => { clearTimeout(t); t = setTimeout(renderBody, 120); };
  $("q").addEventListener("input", debounce);
  $("org").addEventListener("change", renderBody);
  $("sort").addEventListener("change", renderBody);
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
  let rt;
  $("rq").addEventListener("input", () => { clearTimeout(rt); rt = setTimeout(renderReturned, 120); });
  $("rm-status").addEventListener("change", renderReturned);
  $("rm-lang").addEventListener("change", renderReturned);

  boot();
})();
