export const sum = (rows) => rows.reduce((n, r) => n + r.paid_cents, 0);
export const code = (value) => String(value || "").replace(/^0+/, "");
export const unique = (rows, key) => [
  ...new Set(rows.map((r) => r[key]).filter(Boolean)),
];
export function group(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = row[key] || "Unspecified";
    if (!groups.has(id)) groups.set(id, { name: id, rows: [], paid_cents: 0 });
    const g = groups.get(id);
    g.rows.push(row);
    g.paid_cents += row.paid_cents;
  }
  return [...groups.values()].sort(
    (a, b) => b.paid_cents - a.paid_cents || a.name.localeCompare(b.name)
  );
}
export function filterRows(rows, filters, ignore = []) {
  return rows.filter((r) =>
    Object.entries(filters).every(([k, v]) => {
      if (!v || ignore.includes(k)) return true;
      if (k === "q")
        return [r.upc, r.description, r.brand, r.manufacturer, r.flavor]
          .join(" ")
          .toLowerCase()
          .includes(v.toLowerCase());
      return Array.isArray(v) ? !v.length || v.includes(r[k]) : r[k] === v;
    })
  );
}
export function periodMonths(period) {
  const [y, p] = period.split("-");
  if (p.startsWith("Q"))
    return [1, 2, 3].map(
      (n) => `${y}-${String((Number(p[1]) - 1) * 3 + n).padStart(2, "0")}`
    );
  return [period];
}
export function overlap(sources) {
  const seen = new Set();
  for (const s of sources) {
    for (const month of new Set(s.periods.flatMap(periodMonths))) {
      const k = s.state + "|" + month;
      if (seen.has(k))
        return `${s.state} has overlapping reports in ${month}. Select one report for each jurisdiction and period.`;
      seen.add(k);
    }
  }
  return "";
}
export function enrich(rows, catalog) {
  const lookup = new Map(catalog.map((r) => [code(r.upc), r]));
  return rows.map((r) => {
    const match = lookup.get(code(r.upc));
    return {
      ...r,
      manufacturer: match?.manufacturer || "Unspecified",
      flavor: match?.flavor || "Unspecified",
      size: match?.size || r.package_size || "Unspecified",
      attribute: match?.attribute || "Unspecified",
      brand: match?.brand || r.brand,
      brand_key: (match?.brand || r.brand).toLowerCase(),
      category: match?.category || r.category,
      catalog_match: !!match,
    };
  });
}
export function snapshots(sources, cache) {
  const byState = new Map();
  for (const s of sources
    .filter((s) => s.kind === "apl")
    .sort(
      (a, b) =>
        a.as_of.localeCompare(b.as_of) ||
        a.imported_at.localeCompare(b.imported_at)
    )) {
    if (!byState.has(s.state)) byState.set(s.state, []);
    byState.get(s.state).push({ ...s, records: cache.get(s.id) || [] });
  }
  const changes = [];
  for (const [state, history] of byState) {
    if (history.length < 2) continue;
    const before = new Map(history.at(-2).records.map((r) => [code(r.upc), r]));
    const after = new Map(history.at(-1).records.map((r) => [code(r.upc), r]));
    for (const [key, r] of after) {
      if (!before.has(key))
        changes.push({
          ...r,
          state,
          change: "Added",
          date: history.at(-1).as_of,
        });
      else if (JSON.stringify(r) !== JSON.stringify(before.get(key)))
        changes.push({
          ...r,
          state,
          change: "Changed",
          date: history.at(-1).as_of,
        });
    }
    for (const [key, r] of before)
      if (!after.has(key))
        changes.push({
          ...r,
          state,
          change: "Removed",
          date: history.at(-1).as_of,
        });
  }
  return { byState, changes };
}
export function download(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows, keys) {
  const cell = (v) =>
    `"${String(v ?? "")
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
