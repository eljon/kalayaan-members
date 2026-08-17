/**
 * Shared parsing for the LCR class & quorum attendance RSC payload.
 * Used by both the CLI script and the web server.
 */

function extractLine1(flight) {
  const line = flight.split(/\n(?=[0-9a-f]+:)/).find((l) => l.startsWith("1:"));
  if (!line) throw new Error("Line 1 not found in flight payload");
  return JSON.parse(line.slice(2));
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

module.exports = { extractLine1, parse, toCSV };
