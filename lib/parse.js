/**
 * Shared parsing for the LCR class & quorum attendance RSC payload.
 * Used by both the CLI script and the web server.
 */

function extractLine1(flight) {
  const line = flight.split(/\n(?=[0-9a-f]+:)/).find((l) => l.startsWith("1:"));
  if (!line) throw new Error("Line 1 not found in flight payload");
  return JSON.parse(line.slice(2));
}

/**
 * Combine several single-month payloads (each the raw line-1 JSON) into one
 * that `parse` can handle unchanged. LCR returns one month at a time; this
 * is what makes a multi-month roll possible.
 *
 * Weeks and visitors are keyed by their full ISO date, so overlapping or
 * out-of-order months merge without collision. Members are keyed by uuid:
 * a person on the roll in any month appears once, with their attended
 * weeks unioned across every month. Identity fields (name, orgIds) are
 * taken from the most recent month, since that is the freshest record.
 */
function mergeMonths(payloads) {
  const list = (payloads || []).filter(Boolean);
  if (!list.length) throw new Error("mergeMonths: no payloads to merge");

  // Latest month last, so its identity fields win the merge below.
  const maxDate = (p) =>
    (p.weekOptions || []).reduce((m, w) => (w.date > m ? w.date : m), "");
  const ordered = list.slice().sort((a, b) => maxDate(a).localeCompare(maxDate(b)));

  const weekByDate = new Map();
  const visitorByDate = new Map();
  const membersByUuid = new Map();
  const orgOptions = [];
  const seenOrg = new Set();

  for (const p of ordered) {
    for (const wk of p.weekOptions || []) weekByDate.set(wk.date, wk);
    for (const v of p.visitors || []) visitorByDate.set(v.date, v);
    for (const o of p.orgOptions || []) {
      if (!seenOrg.has(o.uuid)) {
        seenOrg.add(o.uuid);
        orgOptions.push(o);
      }
    }
    for (const m of p.members || []) {
      const cur = membersByUuid.get(m.uuid);
      if (!cur) {
        membersByUuid.set(m.uuid, { ...m, weeks: [...(m.weeks || [])] });
      } else {
        const dates = new Set(cur.weeks.map((w) => w.date));
        for (const w of m.weeks || []) {
          if (!dates.has(w.date)) {
            cur.weeks.push(w);
            dates.add(w.date);
          }
        }
        cur.name = m.name || cur.name;
        cur.nameSort = m.nameSort || cur.nameSort;
        cur.gender = m.gender || cur.gender;
        if (m.orgIds && m.orgIds.length) cur.orgIds = m.orgIds;
      }
    }
  }

  const byDate = (a, b) => a.date.localeCompare(b.date);
  return {
    orgId: ordered[ordered.length - 1].orgId,
    unitNumber: ordered[ordered.length - 1].unitNumber,
    orgOptions,
    weekOptions: [...weekByDate.values()].sort(byDate),
    visitors: [...visitorByDate.values()].sort(byDate),
    members: [...membersByUuid.values()],
  };
}

function parse(data) {
  const {
    orgOptions = [],
    weekOptions = [],
    visitors = [],
    members = [],
  } = data;

  const orgNames = {};
  const orgList = [];
  const walk = (orgs, depth = 0) => {
    for (const o of orgs) {
      orgNames[o.uuid] = o.name;
      orgList.push({ uuid: o.uuid, name: o.name, depth });
      if (o.childOrgs) walk(o.childOrgs, depth + 1);
    }
  };
  walk(orgOptions);

  const rows = members.map((m) => {
    const attended = new Set(
      (m.weeks || []).filter((w) => w.didAttend).map((w) => w.date)
    );

    const cells = weekOptions.map((wk) => attended.has(wk.date));
    const total = cells.filter(Boolean).length;

    let weeksSinceSeen = null;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i]) {
        weeksSinceSeen = cells.length - 1 - i;
        break;
      }
    }

    return {
      name: m.name,
      nameSort: m.nameSort || m.name,
      uuid: m.uuid,
      gender: m.gender,
      orgIds: m.orgIds || [],
      orgs: (m.orgIds || []).map((id) => orgNames[id]).filter(Boolean),
      cells,
      total,
      weeksSinceSeen,
      rate: weekOptions.length ? total / weekOptions.length : 0,
    };
  });

  const weekTotals = weekOptions.map((wk, i) => {
    const present = rows.filter((r) => r.cells[i]).length;
    const v = visitors.find((x) => x.date === wk.date) || {};
    const visitorCount =
      (v.men || 0) +
      (v.women || 0) +
      (v.youngMen || 0) +
      (v.youngWomen || 0) +
      (v.children || 0);
    return {
      week: wk.dateDisplay,
      date: wk.date,
      weekCode: wk.weekCode,
      membersPresent: present,
      visitors: visitorCount,
      total: present + visitorCount,
    };
  });

  const attending = rows.filter((r) => r.total > 0).length;

  return {
    unitNumber: data.unitNumber,
    orgId: data.orgId,
    orgList,
    weekOptions,
    weekTotals,
    rows,
    stats: {
      members: rows.length,
      attending,
      absent: rows.length - attending,
      everyWeek: rows.filter((r) => r.total === weekOptions.length).length,
      avgPresent: weekTotals.length
        ? Math.round(
            weekTotals.reduce((a, w) => a + w.membersPresent, 0) /
              weekTotals.length
          )
        : 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}

function toCSV(rows, weekOptions) {
  if (!rows.length) return "";
  const header = [
    "name",
    "gender",
    "orgs",
    ...weekOptions.map((w) => w.dateDisplay),
    "total",
    "rate",
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = rows.map((r) =>
    [
      r.name,
      r.gender,
      r.orgs.join("; "),
      ...r.cells.map((c) => (c ? 1 : 0)),
      r.total,
      r.rate.toFixed(2),
    ]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

module.exports = { extractLine1, parse, mergeMonths, toCSV };
