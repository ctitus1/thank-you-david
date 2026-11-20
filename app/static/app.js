import {
  sum,
  code,
  unique,
  group,
  filterRows,
  overlap,
  enrich,
  snapshots,
  download,
  csv,
} from "./analytics.js";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
const num = (n) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
const money = (c) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
const exact = (c) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100
  );
const compact = (c) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(c / 100);
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const period = (p) =>
  p?.includes("Q")
    ? `${p.split("-")[1]} ${p.slice(0, 4)}`
    : p
    ? new Date(p + "-02T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "";
const date = (d) =>
  d
    ? new Date(d + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown";
const icons = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  products: "M4 5h16v15H4zM8 2v6m8-6v6M8 12h8m-8 4h5",
  brands: "M4 20V10m8 10V4m8 16v-7",
  approvals: "m7 11 3 3 7-7M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6Z",
  sources: "M4 7v13h16V7M2 3h20v4H2zM9 12h6",
  method: "M4 3h6c2 0 2 2 2 2s0-2 2-2h6v17h-6c-2 0-2 1-2 1s0-1-2-1H4zM12 5v16",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  plus: "M12 4v16M4 12h16",
  refresh: "M20 8a9 9 0 1 0 0 8M20 2v6h-6",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  filter: "M3 5h18M6 12h12m-8 7h4",
  trend: "m3 17 6-6 4 3 8-10m-6 0h6v6",
  save: "M5 3h14v18l-7-5-7 5z",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${
    icons[n] || icons.products
  }" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const state = {
  view: location.hash.slice(1) || "overview",
  sources: [],
  cache: new Map(),
  selected: [],
  filters: {
    q: "",
    period: "",
    state: "",
    category: "",
    brand_key: "",
    manufacturer: "",
    flavor: "",
    size: "",
    attribute: "",
    unit: "",
  },
  page: 0,
  sort: "paid_cents",
  direction: -1,
  brands: [],
  watch: [],
  views: [],
  aplTab: "matrix",
  aplSearch: "",
  onlyWatched: false,
  import: null,
  catalog: [],
  loading: false,
};
let visibleRows = [],
  exportRows = [],
  chartGroups = [],
  toastTimer;
async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "X-WIC-Client": "local",
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error(
      "The server could not complete this request. Check the local server and try again."
    );
  }
  if (!response.ok)
    throw Error(
      typeof result.detail === "string"
        ? result.detail
        : "The request could not be completed. Check the form values."
    );
  return result;
}
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5500);
}
async function load() {
  state.sources = await api("/sources");
  const refs = state.sources.filter(
    (s) => s.kind === "apl" || s.kind === "catalog"
  );
  await Promise.all(refs.map((s) => loadSource(s.id)));
  const catalog = state.sources.find((s) => s.kind === "catalog");
  state.catalog = catalog ? state.cache.get(catalog.id) : [];
  const available = state.sources.filter((s) => s.kind === "redemption");
  state.selected = state.selected.filter((id) =>
    available.some((s) => s.id === id)
  );
  if (!state.selected.length && available.length)
    state.selected = [
      available.find((s) => s.state === "IN")?.id || available[0].id,
    ];
  await Promise.all(state.selected.map(loadSource));
  state.watch = await api("/settings/watchlist");
  state.views = await api("/settings/views");
  if (!Array.isArray(state.watch)) state.watch = [];
  if (!Array.isArray(state.views)) state.views = [];
}
async function loadSource(id) {
  if (!state.cache.has(id)) {
    const r = await api("/sources/" + id);
    state.cache.set(id, r.records);
  }
}
function allRows() {
  return enrich(
    state.selected.flatMap((id) =>
      (state.cache.get(id) || []).map((r) => ({
        ...r,
        source_id: id,
        state: state.sources.find((s) => s.id === id).state,
      }))
    ),
    state.catalog
  );
}
function selectedSources() {
  return state.sources.filter((s) => state.selected.includes(s.id));
}
function filtered() {
  return filterRows(allRows(), state.filters);
}
function options(values, selected, empty) {
  return (
    `<option value="">${esc(empty)}</option>` +
    values
      .map(
        (v) =>
          `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(
            v
          )}</option>`
      )
      .join("")
  );
}
function filterSelect(key, label, values) {
  return `<label>${label}<select data-filter="${key}">${options(
    values,
    state.filters[key],
    "All " + label.toLowerCase()
  )}</select></label>`;
}
function basicFilters() {
  const rows = allRows();
  return `<div class="filters"><label>Search products<input id="product-search" data-filter="q" type="search" placeholder="Product, brand, or UPC" value="${esc(
    state.filters.q
  )}"></label>${filterSelect(
    "category",
    "Categories",
    unique(rows, "category").sort()
  )}${filterSelect(
    "brand_key",
    "Brands",
    unique(rows, "brand_key").sort()
  )}<button data-action="reset" class="quiet">Reset filters</button></div>`;
}
function scope() {
  const sources = selectedSources();
  const rows = allRows();
  return `<div class="scopebar"><span class="scope-label">Report scope</span><button data-action="choose-sources">${icon(
    "sources"
  )}${
    sources.length > 1
      ? `${sources.length} reports`
      : esc(sources[0]?.state || "Select data")
  } <span class="muted">⌄</span></button><button class="quiet" data-action="choose-periods">Select periods</button><select aria-label="Report period" data-filter="period">${
    (Array.isArray(state.filters.period)
      ? `<option value="">${state.filters.period.length} selected periods</option>`
      : '<option value="">All reported periods</option>') +
    unique(rows, "period")
      .sort()
      .map(
        (p) =>
          `<option value="${p}" ${
            state.filters.period === p ? "selected" : ""
          }>${period(p)}</option>`
      )
      .join("")
  }</select><select aria-label="Jurisdiction" data-filter="state">${options(
    unique(rows, "state").sort(),
    state.filters.state,
    "All jurisdictions"
  )}</select><span class="spacer"></span><span class="badge"><span class="dot"></span>${
    sources.every((s) => !s.origin) ? "Local files" : "Saved source data"
  }</span><button data-action="save-view" class="quiet" title="Save the current report selection and filters">${icon(
    "save"
  )}Save view</button></div>`;
}
function metrics(rows) {
  const known = rows.filter((r) => r.brand_key !== "unspecified");
  return `<div class="metrics"><div class="metric"><div class="eyebrow">Recorded redemptions</div><div class="value" title="${exact(
    sum(rows)
  )}">${money(
    sum(rows)
  )}</div><div class="detail">USD · within the selected scope</div></div><div class="metric"><div class="eyebrow">Products redeemed</div><div class="value">${num(
    new Set(rows.filter((r) => r.upc).map((r) => code(r.upc))).size
  )}</div><div class="detail">Distinct reported product codes</div></div><div class="metric"><div class="eyebrow">Reported brands</div><div class="value">${num(
    unique(known, "brand_key").length
  )}</div><div class="detail">${num(
    rows.length - known.length
  )} records have no brand</div></div><div class="metric"><div class="eyebrow">Food categories</div><div class="value">${num(
    unique(rows, "category").length
  )}</div><div class="detail">${num(
    rows.length
  )} source records</div></div></div>`;
}
function bars(groups, key = "category", limit = 8) {
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.paid_cents)));
  return `<div class="bars">${groups
    .slice(0, limit)
    .map(
      (g) =>
        `<div class="bar-line"><button class="bar-label" title="Filter: ${esc(
          g.name
        )}" data-filter-value="${esc(g.name)}" data-filter-key="${key}">${esc(
          g.name
        )}</button><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${
          (Math.abs(g.paid_cents) / max) * 100
        }%"></div></div><span class="bar-value" title="${exact(
          g.paid_cents
        )}">${compact(g.paid_cents)}</span></div>`
    )
    .join("")}</div>`;
}
function empty(title, text, action = "sources", label = "Add a source") {
  return `<div class="panel empty"><h2>${title}</h2><p>${text}</p><button data-nav="${action}" class="primary">${label} ${icon(
    "arrow"
  )}</button></div>`;
}
function scopeWarning() {
  const items = selectedSources();
  const signatures = new Set(items.map((s) => JSON.stringify(s.periods)));
  return signatures.size > 1
    ? `<div class="notice">These reports cover different periods. Choose a common period before comparing jurisdictions. Combined totals describe the selected records only.</div>`
    : "";
}
function overview() {
  const rows = filtered();
  chartGroups = group(rows, "category");
  exportRows = rows;
  if (!rows.length)
    return empty(
      "No records in this view",
      "Adjust the filters or add a redemption report."
    );
  const s = selectedSources();
  return `${basicFilters()}${scopeWarning()}${metrics(
    rows
  )}<div class="grid-main"><section class="panel"><div class="panel-head"><div><h2>Where benefits were redeemed</h2><p>Recorded spending by food category</p></div><button class="quiet" data-action="export-chart" aria-label="Export category chart as SVG">${icon(
    "download"
  )}</button></div><div class="panel-body">${bars(
    chartGroups
  )}</div><div class="chart-foot"><span>Top ${Math.min(
    8,
    chartGroups.length
  )} of ${
    chartGroups.length
  } categories · select a label to filter</span><span>USD</span></div></section><aside class="context-card"><div><div class="eyebrow">A clear view of the source</div><h2>Inside this report</h2><p>${esc(
    s
      .flatMap((x) => x.notes)
      .find(
        (n) => n.includes("12 food categories") || n.includes("Coverage is")
      ) ||
      "These reports describe recorded purchases. Spending does not measure how much of a family’s benefit was used."
  )}</p><div class="scope-fact"><span>Jurisdictions</span><strong>${unique(
    rows,
    "state"
  )
    .map(esc)
    .join(
      ", "
    )}</strong></div><div class="scope-fact"><span>Reporting periods</span><strong>${
    unique(rows, "period").length
  }</strong></div></div><button class="text-button" data-nav="method">Read the data notes ${icon(
    "arrow"
  )}</button></aside></div>${trends(
    rows
  )}<section class="panel"><div class="panel-head"><div><h2>Products at a glance</h2><p>Highest recorded spending in the current view</p></div><button class="text-button" data-nav="products">Explore all products →</button></div>${productTable(
    rows,
    6,
    false
  )}</section>`;
}
function trends(rows) {
  const series = group(rows, "period").sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  if (series.length < 2) return "";
  const max = Math.max(1, ...series.map((s) => Math.abs(s.paid_cents)));
  return `<section class="panel" style="margin-bottom:24px"><div class="panel-head"><div><h2>Spending over time</h2><p>Each bar is a reported period. Missing periods have no bar. Coverage can differ between reports.</p></div><button class="quiet" data-action="export-trend">${icon(
    "download"
  )}Export</button></div><div class="panel-body"><div class="plot">${series
    .map(
      (g) =>
        `<div class="plot-col"><span>${compact(
          g.paid_cents
        )}</span><div class="plot-bar" style="height:${
          (Math.abs(g.paid_cents) / max) * 120
        }px" title="${exact(g.paid_cents)}"></div><span>${period(
          g.name
        )}</span></div>`
    )
    .join("")}</div></div></section>`;
}
function productTable(rows, pageSize = 25, paginate = true) {
  const sorted = [...rows].sort((a, b) =>
    typeof a[state.sort] === "number"
      ? (a[state.sort] - b[state.sort]) * state.direction
      : String(a[state.sort] || "").localeCompare(String(b[state.sort] || "")) *
        state.direction
  );
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  state.page = Math.min(state.page, pages - 1);
  const start = paginate ? state.page * pageSize : 0;
  visibleRows = sorted.slice(start, start + pageSize);
  return `<div class="table-wrap"><table class="data-table"><caption class="sr-only">Product redemption records with original source details</caption><thead><tr><th><span class="sr-only">Watch</span></th><th><button data-sort="description">Product ${
    state.sort === "description" ? "↕" : ""
  }</button></th><th>Category</th><th>Quantity</th><th class="numeric"><button data-sort="paid_cents">Paid amount ${
    state.sort === "paid_cents" ? "↓" : ""
  }</button></th><th class="numeric">Share of view</th></tr></thead><tbody>${visibleRows
    .map(
      (r, i) =>
        `<tr><td><button class="star ${
          state.watch.includes(code(r.upc)) ? "on" : ""
        }" data-watch="${esc(r.upc)}" ${!r.upc ? "disabled" : ""} aria-label="${
          state.watch.includes(code(r.upc)) ? "Unwatch" : "Watch"
        } ${esc(r.description)}" aria-pressed="${state.watch.includes(
          code(r.upc)
        )}">${
          state.watch.includes(code(r.upc)) ? "★" : "☆"
        }</button></td><td><button class="product-name" data-product="${i}">${esc(
          r.description
        )}</button><span class="subline">${esc(r.brand)} · ${esc(
          r.upc || "Code not reported"
        )}</span></td><td><span class="category-pill">${esc(
          r.category
        )}</span></td><td>${
          r.quantity === null ? "—" : num(r.quantity)
        } <span class="muted small">${esc(
          r.unit
        )}</span><span class="subline">${esc(r.state)} · ${period(
          r.period
        )}</span></td><td class="numeric">${exact(
          r.paid_cents
        )}</td><td class="numeric">${pct(r.paid_cents, sum(rows))}</td></tr>`
    )
    .join("")}</tbody></table></div>${
    paginate
      ? `<div class="table-foot"><span>${num(start + 1)}–${num(
          Math.min(start + pageSize, sorted.length)
        )} of ${num(
          sorted.length
        )} records</span><div class="row"><button data-page="${
          state.page - 1
        }" ${state.page === 0 ? "disabled" : ""}>← Previous</button><span>${
          state.page + 1
        } / ${pages}</span><button data-page="${state.page + 1}" ${
          state.page >= pages - 1 ? "disabled" : ""
        }>Next →</button></div></div>`
      : ""
  }`;
}
function products() {
  const rows = filtered();
  exportRows = rows;
  const all = allRows();
  return `${basicFilters()}<details style="margin-bottom:20px"><summary class="small muted">Product attributes ${
    state.catalog.length
      ? "· catalog connected"
      : "· add a product catalog to filter manufacturer, flavor, and attributes"
  }</summary><div class="filters" style="margin-top:15px">${filterSelect(
    "manufacturer",
    "Manufacturers",
    unique(all, "manufacturer").sort()
  )}${filterSelect(
    "flavor",
    "Flavors",
    unique(all, "flavor").sort()
  )}${filterSelect("size", "Sizes", unique(all, "size").sort())}${filterSelect(
    "unit",
    "Units",
    unique(all, "unit").sort()
  )}${filterSelect(
    "attribute",
    "Attributes",
    unique(all, "attribute").sort()
  )}</div></details>${
    rows.length
      ? `<section class="panel"><div class="panel-head"><div><h2>Product explorer <span class="badge">${num(
          rows.length
        )} records</span></h2><p>Select a product for pricing, source details, and catalog attributes.</p></div><span class="small muted">${money(
          sum(rows)
        )} in this view</span></div>${productTable(rows)}</section>${pricing(
          rows
        )}`
      : empty(
          "No matching products",
          "Use fewer filters or search for a different brand or code.",
          "products",
          "Clear the search"
        )
  }`;
}
function pricing(rows) {
  const eligible = rows.filter((r) => r.packages > 0 && r.unit !== "$$$");
  const comparable =
    unique(rows, "category").length === 1 &&
    unique(rows, "size").length === 1 &&
    unique(rows, "unit").length === 1;
  if (!comparable)
    return '<div class="notice" style="margin-top:20px">For price comparisons, filter to one category, package size, and unit in Product attributes.</div>';
  const groups = group(eligible, "brand_key").map((g) => ({
    ...g,
    paid_cents: g.paid_cents / g.rows.reduce((n, r) => n + r.packages, 0),
  }));
  return `<section class="panel" style="margin-top:22px"><div class="panel-head"><div><h2>Price per package, by brand</h2><p>Weighted price = paid amount ÷ reported packages. Same category, size, and unit. ${
    rows.length - eligible.length
  } records excluded for missing package counts or cash-value units.</p></div><button data-action="export-prices" class="quiet">${icon(
    "download"
  )}Export</button></div><div class="panel-body">${bars(
    groups,
    "brand_key"
  )}</div></section>`;
}
function brands() {
  const rows = filtered();
  const groups = group(rows, "brand_key");
  chartGroups = groups;
  exportRows = groups.map((g) => ({
    brand: g.name,
    paid_amount: g.paid_cents / 100,
    share: pct(g.paid_cents, sum(rows)),
    products: unique(g.rows, "upc").length,
  }));
  return `${basicFilters()}<div class="notice">Shares use the selected records as the denominator. They are not shares of the entire WIC market.</div>${
    state.brands.length
      ? `<div class="comparison">${state.brands
          .map((b) => {
            const g = groups.find((x) => x.name === b) || {
              rows: [],
              paid_cents: 0,
            };
            return `<div class="panel compare-card"><h2>${esc(
              b
            )}</h2><div class="value">${money(
              g.paid_cents
            )}</div><div class="stat"><span>Share of view</span><strong>${pct(
              g.paid_cents,
              sum(rows)
            )}</strong></div><div class="stat"><span>Reported products</span><strong>${
              unique(g.rows, "upc").length
            }</strong></div></div>`;
          })
          .join("")}</div>`
      : ""
  }<section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Brand share in this view</h2><p>Top eight brands by recorded spending. Exact shares appear in the table.</p></div></div><div class="panel-body">${bars(
    groups,
    "brand_key"
  )}</div></section><section class="panel"><div class="panel-head"><div><h2>Brand comparison</h2><p>Select up to three brands. Unspecified records remain in the denominator.</p></div><button class="quiet" data-action="export-chart">${icon(
    "download"
  )}Chart</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Compare</th><th>Brand or source group</th><th class="numeric">Products</th><th class="numeric">Paid amount</th><th class="numeric">Share of view</th></tr></thead><tbody>${groups
    .map(
      (g) =>
        `<tr><td><input type="checkbox" aria-label="Compare ${esc(
          g.name
        )}" data-compare="${esc(g.name)}" ${
          state.brands.includes(g.name) ? "checked" : ""
        }></td><td>${esc(g.name)}</td><td class="numeric">${
          unique(g.rows, "upc").length
        }</td><td class="numeric">${exact(
          g.paid_cents
        )}</td><td class="numeric">${pct(g.paid_cents, sum(rows))}</td></tr>`
    )
    .join("")}</tbody></table></div></section>`;
}
function brandCoverage(states, maps) {
  if (!state.catalog.length || state.aplTab !== "matrix") return "";
  const groups = group(
    state.catalog.filter((r) => r.brand),
    "brand"
  );
  if (!groups.length) return "";
  return `<section class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h2>Compare brand approval coverage</h2><p>Listed UPCs / UPCs supplied in your product catalog. A missing snapshot means unknown coverage.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Catalog brand</th>${states
    .map((s) => `<th>${esc(s)}</th>`)
    .join("")}</tr></thead><tbody>${groups
    .map(
      (g) =>
        `<tr><td>${esc(g.name)}</td>${states
          .map(
            (s) =>
              `<td>${
                maps.has(s)
                  ? `${
                      g.rows.filter((r) => maps.get(s).has(code(r.upc))).length
                    } / ${g.rows.length}`
                  : "No snapshot"
              }</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody></table></div></section>`;
}
function approvalView() {
  const { byState, changes } = snapshots(state.sources, state.cache);
  const states = [
    ...new Set([
      ...byState.keys(),
      ...state.sources
        .filter((s) => s.kind === "redemption")
        .map((s) => s.state),
    ]),
  ].sort();
  const lookup = new Map(
    state.catalog.map((r) => [
      code(r.upc),
      Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")),
    ])
  );
  const union = new Map();
  const maps = new Map();
  for (const [s, h] of byState) {
    const m = new Map(h.at(-1).records.map((r) => [code(r.upc), r]));
    maps.set(s, m);
    for (const [k, r] of m) union.set(k, { ...r, ...lookup.get(k) });
  }
  for (const r of state.catalog)
    if (!union.has(code(r.upc))) union.set(code(r.upc), r);
  for (const k of state.watch)
    if (!union.has(k))
      union.set(k, {
        upc: k,
        description: lookup.get(k)?.description || "Watched product",
        ...lookup.get(k),
      });
  const matches = (r) =>
    (!state.onlyWatched || state.watch.includes(code(r.upc))) &&
    [r.upc, r.description, r.brand, r.manufacturer]
      .join(" ")
      .toLowerCase()
      .includes(state.aplSearch.toLowerCase());
  const rows = [...union.values()].filter(matches);
  const filteredChanges = changes
    .map((r) => ({ ...r, ...lookup.get(code(r.upc)) }))
    .filter(matches);
  const missingHistory = states.filter(
    (s) => byState.has(s) && byState.get(s).length < 2
  );
  exportRows =
    state.aplTab === "changes"
      ? filteredChanges
      : rows.map((r) => ({
          upc: r.upc,
          description: r.description,
          brand: r.brand || "Unspecified",
          ...Object.fromEntries(
            states.map((s) => [
              s,
              maps.get(s)?.has(code(r.upc))
                ? "Listed"
                : maps.has(s)
                ? "Not listed in snapshot"
                : "No snapshot",
            ])
          ),
        }));
  const controls = `<div class="filters"><label>Search approvals<input id="apl-search" type="search" placeholder="UPC, product, or catalog brand" value="${esc(
    state.aplSearch
  )}"></label><label class="checkbox-label"><input type="checkbox" id="only-watch" ${
    state.onlyWatched ? "checked" : ""
  }>Watched products only (${
    state.watch.length
  })</label><button data-action="add-watch">${icon(
    "plus"
  )}Watch a UPC</button></div>`;
  return `<div class="tabs"><button data-apl-tab="matrix" class="${
    state.aplTab === "matrix" ? "active" : ""
  }">Approval matrix</button><button data-apl-tab="changes" class="${
    state.aplTab === "changes" ? "active" : ""
  }">Snapshot changes <span class="badge">${
    changes.length
  }</span></button></div>${controls}<div class="notice">“Listed” means present in the selected snapshot. “Not listed” does not establish ineligibility. Snapshot dates appear below each jurisdiction.</div>${brandCoverage(
    states,
    maps
  )}${
    !byState.size
      ? empty(
          "Add your first approval list",
          "Fetch California’s public list or import a dated APL file. Compare jurisdictions, watch products, and track changes."
        )
      : state.aplTab === "matrix"
      ? `<section class="panel"><div class="panel-head"><div><h2>Approvals across jurisdictions</h2><p>${num(
          rows.length
        )} product codes · latest imported snapshot per jurisdiction · catalog attributes appear when supplied</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Watch</th><th>Product / UPC</th>${states
          .map(
            (s) =>
              `<th>${esc(s)}<span class="date">${date(
                byState.get(s)?.at(-1).as_of
              )}</span></th>`
          )
          .join("")}</tr></thead><tbody>${rows
          .slice(state.page * 50, state.page * 50 + 50)
          .map(
            (r) =>
              `<tr><td><button class="star ${
                state.watch.includes(code(r.upc)) ? "on" : ""
              }" data-watch="${esc(r.upc)}" aria-label="Watch ${esc(
                r.description || r.upc
              )}">${
                state.watch.includes(code(r.upc)) ? "★" : "☆"
              }</button></td><td>${esc(
                r.description || "Description not supplied"
              )}<span class="subline">${esc(r.upc)}${
                r.brand ? " · " + esc(r.brand) : ""
              }</span></td>${states
                .map(
                  (s) =>
                    `<td>${
                      maps.get(s)?.has(code(r.upc))
                        ? '<span class="approval-listed">✓ Listed</span>'
                        : maps.has(s)
                        ? '<span class="approval-absent">Not listed</span>'
                        : '<span class="approval-absent">No snapshot</span>'
                    }</td>`
                )
                .join("")}</tr>`
          )
          .join("")}</tbody></table></div><div class="table-foot"><span>${num(
          rows.length
        )} results · ${
          states.length
        } jurisdictions</span><div class="row"><button data-page="${
          state.page - 1
        }" ${
          state.page === 0 ? "disabled" : ""
        }>← Previous</button><button data-page="${state.page + 1}" ${
          (state.page + 1) * 50 >= rows.length ? "disabled" : ""
        }>Next →</button></div></div></section>`
      : `${
          missingHistory.length
            ? `<div class="notice">${missingHistory
                .map(esc)
                .join(
                  ", "
                )}: import a second dated snapshot to detect changes. A first snapshot is a baseline, not an approval event.</div>`
            : ""
        }<section class="panel"><div class="panel-head"><div><h2>Changes between the two latest snapshots</h2><p>Changes describe file differences. They do not give an official approval or removal date.</p></div></div>${
          filteredChanges.length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Change</th><th>Product</th><th>Jurisdiction</th><th>Snapshot date</th></tr></thead><tbody>${filteredChanges
                .slice(0, 500)
                .map(
                  (r) =>
                    `<tr><td><span class="badge">${
                      r.change
                    }</span></td><td>${esc(
                      r.description
                    )}<span class="subline">${esc(r.upc)}</span></td><td>${esc(
                      r.state
                    )}</td><td>${date(r.date)}</td></tr>`
                )
                .join(
                  ""
                )}</tbody></table></div><div class="table-foot">Showing up to 500 changes. Export includes all matching changes.</div>`
            : '<div class="empty"><h2>No changes to show</h2><p>Refresh or import another snapshot to compare. Change alerts appear here while the local app is open.</p></div>'
        }</section>`
  }<div class="panel" style="margin-top:22px"><div class="panel-head"><div><h2>Coverage by WIC participation</h2><p>Upload jurisdiction participation counts to weight approval coverage. The denominator is the jurisdictions in that file.</p></div><button data-action="participation">Set participation weights</button></div><div class="panel-body" id="coverage-result"><p class="small">Participation weighting requires a dated source and counts. No population estimates are inferred.</p></div></div>`;
}
function sourcesView() {
  exportRows = state.sources.map(
    ({ id, name, state, kind, as_of, count, sha256, origin }) => ({
      id,
      name,
      state,
      kind,
      as_of,
      count,
      sha256,
      origin,
    })
  );
  return `<div class="source-grid"><section class="panel source-card"><div class="source-icon">${icon(
    "sources"
  )}</div><h2>Your files, ready to explore.</h2><p>Import redemption reports, approval snapshots, or a product catalog. Preview the data before you save it.</p><button class="primary" data-action="import">${icon(
    "plus"
  )}Import a file</button><button class="quiet" data-action="templates">CSV templates</button></section><section class="panel source-card"><div class="source-icon">${icon(
    "refresh"
  )}</div><h2>Fresh from public sources.</h2><p>Download published reports on demand. Each saved version remains available offline.</p><div class="row wrap"><button data-live="tx">Texas redemptions ${icon(
    "arrow"
  )}</button><button data-live="ca">California APL ${icon(
    "arrow"
  )}</button></div></section></div><section class="panel"><div class="panel-head"><div><h2>Source library <span class="badge">${
    state.sources.length
  }</span></h2><p>Original files, reporting scope, and import history in one place.</p></div><div class="row"><button data-action="monitor-settings">Automatic checks</button><a href="/api/backup" class="small">Back up workspace ↓</a></div></div>${
    state.sources
      .map(
        (s) =>
          `<div class="list-item"><div class="row"><span class="state-tag">${esc(
            s.state || "CAT"
          )}</span><div><h3 class="source-name">${esc(s.name)}</h3><p>${esc(
            s.kind
          )} · ${num(s.count)} records · ${
            s.kind === "apl"
              ? "Snapshot " + date(s.as_of)
              : s.periods.map(period).join(", ") || "Product enrichment"
          }<br>${
            s.origin ? "Public source" : "Local import"
          } · imported ${new Date(s.imported_at).toLocaleDateString(
            "en-US"
          )}</p></div></div><button data-source="${
            s.id
          }">Source details ↗</button></div>`
      )
      .join("") ||
    '<div class="empty"><p>No sources yet. Import a file to start.</p></div>'
  }</section>${
    state.views.length
      ? `<section class="panel" style="margin-top:22px"><div class="panel-head"><h2>Saved views</h2></div>${state.views
          .map(
            (v, i) =>
              `<div class="list-item"><div><h3>${esc(v.name)}</h3><p>${
                v.selected.length
              } reports · saved filters</p></div><button data-saved="${i}">Open view →</button></div>`
          )
          .join("")}</section>`
      : ""
  }`;
}
function method() {
  const notes = [...new Set(selectedSources().flatMap((s) => s.notes || []))];
  return `<div class="method panel"><section><div class="eyebrow">Read before comparing</div><h2 style="margin-top:12px">The numbers should be explainable.</h2><p>This workspace analyzes aggregate WIC redemption reports and dated Approved Product Lists (APLs). It does not connect to family accounts.</p></section><section><h2>Coverage of the selected reports</h2><ul>${
    notes.map((n) => `<li>${esc(n)}</li>`).join("") ||
    "<li>No redemption source selected.</li>"
  }</ul></section><section><h2>Amounts, shares, and prices</h2><p>Paid amounts are rounded to cents per source row and summed as integers. Negative adjustments remain in net totals. Blank values stay missing.</p><p>Share of view equals a row or group’s paid amount divided by the current filtered total. This is not a benefit redemption rate.</p><p>A product’s price is paid amount divided by package count, when that count is positive. Do not average the source’s rounded prices. Package counts may themselves be rounded.</p><p>Quantity retains the source unit. Dollars, gallons, ounces, and packages are never added into one quantity total.</p></section><section><h2>Comparisons and product attributes</h2><p>The app blocks reports with overlapping periods in the same jurisdiction. Report coverage can still differ across jurisdictions and dates. Check the scope before comparing.</p><p>Monthly reports and quarterly reports remain distinct. Missing periods have no chart bar. There is no interpolation, annualization, or causal claim.</p><p>A product catalog can supply manufacturer, brand, flavor, size, category, and an attribute such as whole grain. Missing attributes appear as Unspecified.</p><p>Joins ignore leading zeros in product codes. Original codes remain visible and exportable. Brand grouping only normalizes case and whitespace.</p></section><section><h2>Approval snapshots and alerts</h2><p>The latest imported snapshot date determines each jurisdiction’s APL view. Changes compare the latest two snapshots. The first snapshot creates no change alerts.</p><p>A missing product is not proof of ineligibility. Fresh produce may use mapped PLU codes. Consult the state’s current list for purchase decisions.</p><p>Watch alerts appear in this app after a new snapshot is imported. Optional scheduled checks run while the local server is active. Alerts stay in this app. No messages are sent.</p></section><section><h2>Local and reproducible</h2><p>Files and data stay in this repository’s SQLite database. Public downloads run on demand or on the optional schedule you enable. The app has no analytics, external fonts, or CDN scripts.</p><p>Every source keeps its original bytes, checksum, worksheet, and import date. Product details include the original row number.</p><p>Source adapters currently cover the Indiana export format, Texas peanut and seed butter reports, California UPC lists, and the documented CSV formats.</p><p><a href="https://www.hellolulo.com/wic-tools" target="_blank" rel="noreferrer">Lulo’s public data-tool feature reference ↗</a> · <a href="https://www.cdph.ca.gov/Programs/CFH/DWICSN/Pages/WICFoods/CAWICAPL.aspx" target="_blank" rel="noreferrer">California APL guidance ↗</a></p></section></div>`;
}
const titles = {
  overview: [
    "Redemption overview",
    "WIC spending by category, brand, and product.",
  ],
  products: ["Product explorer", "Search, filter, and inspect source records."],
  brands: [
    "Brands & market share",
    "Compare spending and share within selected reports.",
  ],
  approvals: [
    "Product approvals",
    "Compare dated product lists across jurisdictions.",
  ],
  sources: ["Data sources", "Import, refresh, and review your reports."],
  method: ["Data notes", "Definitions, calculations, and source limits."],
};
function render() {
  const active = document.activeElement;
  const focusId = active?.id;
  const focusAttribute = [
    "data-filter",
    "data-action",
    "data-nav",
    "data-compare",
  ].find((k) => active?.hasAttribute(k));
  const focusValue = focusAttribute
    ? active.getAttribute(focusAttribute)
    : null;
  const selection = active?.selectionStart;
  if (!titles[state.view]) state.view = "overview";
  const [title, subtitle] = titles[state.view];
  const dataView = ["overview", "products", "brands"].includes(state.view);
  const alerts = snapshots(state.sources, state.cache).changes.filter((r) =>
    state.watch.includes(code(r.upc))
  ).length;
  $(
    "#app"
  ).innerHTML = `<aside class="sidebar"><a class="brand" href="#overview"><img src="/static/mark.svg" alt=""><span class="wordmark">thank you,<br> david.</span></a><div class="eyebrow side-label">WIC data workspace</div><nav class="nav" aria-label="Main navigation">${[
    ["overview", "Overview"],
    ["products", "Products"],
    ["brands", "Brands & share"],
    ["approvals", "Approval monitor"],
    ["sources", "Data sources"],
    ["method", "Data notes"],
  ]
    .map(
      ([id, label], i) =>
        `${
          i === 4 ? '<div class="nav-separator"></div>' : ""
        }<button data-nav="${id}" class="${
          state.view === id ? "active" : ""
        }" ${state.view === id ? 'aria-current="page"' : ""}>${icon(
          id
        )}${label}${
          id === "approvals" && alerts
            ? ` <span class="badge">${alerts}</span>`
            : ""
        }</button>`
    )
    .join(
      ""
    )}</nav><div class="side-bottom"><strong><span class="dot"></span> Your local workspace</strong><p>Saved data works offline.</p></div></aside><div class="shell"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> ${esc(
    title
  )}</div><div class="row"><div class="local"><span class="dot"></span> Local server</div><div class="avatar" aria-label="Thank you David">TD</div></div></header><main id="main" class="content"><div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${
    state.view !== "method"
      ? `<button data-action="export">${icon("download")}Export data</button>`
      : ""
  }<button class="primary" data-action="import">${icon(
    "plus"
  )}Add data</button></div></div>${dataView ? scope() : ""}${
    dataView && !state.selected.length
      ? empty(
          "Start with a source",
          "Import a redemption report to explore products, brands, categories, and spending."
        )
      : {
          overview,
          products,
          brands,
          approvals: approvalView,
          sources: sourcesView,
          method,
        }[state.view]()
  }<footer class="footer"><span>Thank you, David · WIC data workspace</span><span>Report scope and source dates stay with the data.</span></footer></main></div>`;
  if (focusId || focusAttribute) {
    const el = focusId
      ? document.getElementById(focusId)
      : document.querySelector(
          `[${focusAttribute}="${CSS.escape(focusValue)}"]`
        );
    if (el && !$("#dialog").open) {
      el.focus();
      if (typeof selection === "number")
        try {
          el.setSelectionRange(selection, selection);
        } catch {}
    }
  }
}
function modal(title, body, actions = "") {
  const d = $("#dialog");
  d.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="close" data-action="close" aria-label="Close dialog">×</button></div><div class="dialog-body">${body}</div>${
    actions ? `<div class="dialog-actions">${actions}</div>` : ""
  }`;
  if (!d.open) d.showModal();
}
function errorInDialog(error) {
  const target = $("#dialog-error");
  if (target) target.textContent = error.message;
  else notify(error.message);
}
function sourceDetails(id) {
  const s = state.sources.find((x) => x.id === id);
  modal(
    "Source details",
    `<p>${esc(
      s.name
    )}</p><dl class="source-detail"><dt>Jurisdiction</dt><dd>${esc(
      s.state || "Product catalog"
    )}</dd><dt>Worksheet</dt><dd>${esc(s.sheet)}</dd><dt>Records</dt><dd>${num(
      s.count
    )}</dd><dt>Report period</dt><dd>${
      s.periods.map(period).join(", ") || date(s.as_of)
    }</dd><dt>Imported</dt><dd>${new Date(
      s.imported_at
    ).toLocaleString()}</dd><dt>SHA-256</dt><dd class="mono">${
      s.sha256
    }</dd><dt>Source</dt><dd>${
      s.origin
        ? `<a href="${esc(
            s.origin
          )}" target="_blank" rel="noreferrer">Public download ↗</a>`
        : "Local file"
    }</dd></dl>${(s.notes || [])
      .map((n) => `<p style="margin-top:10px">${esc(n)}</p>`)
      .join("")}`,
    `<a href="/api/sources/${s.id}/original">Download original file ↓</a><button data-action="close">Close</button>`
  );
}
function productDetails(index) {
  const r = visibleRows[index];
  const source = state.sources.find((s) => s.id === r.source_id);
  modal(
    "Product record",
    `<h2>${esc(r.description)}</h2><p>${esc(r.brand)} · ${esc(
      r.upc || "No product code"
    )}</p><dl class="source-detail">${[
      ["Jurisdiction", r.state],
      ["Period", period(r.period)],
      ["Category", r.category],
      ["Subcategory", r.subcategory || "Unspecified"],
      ["Paid amount", exact(r.paid_cents)],
      [
        "Quantity",
        r.quantity === null ? "Not supplied" : `${num(r.quantity)} ${r.unit}`,
      ],
      ["Package count", r.packages === null ? "Not supplied" : num(r.packages)],
      [
        "Price per package",
        r.packages > 0 ? exact(r.paid_cents / r.packages) : "Not available",
      ],
      ["Package size", r.size + " " + r.unit],
      ["Manufacturer", r.manufacturer],
      ["Flavor", r.flavor],
      ["Attribute", r.attribute],
      ["Source row", source.sheet + " · row " + r.source_row],
      ["Source file", source.name],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
      .join(
        ""
      )}</dl><p>Price uses paid amount divided by package count. It is not a store shelf price. Source package counts may be rounded.</p>`,
    `<button data-source="${source.id}">Source details</button><button data-action="close">Close</button>`
  );
}
function importDialog(info = null) {
  state.import = info;
  modal(
    info ? "Review import" : "Add data to your workspace",
    `${
      info
        ? `<p><strong>${esc(info.name)}</strong></p>`
        : "<p>Choose a file and data type. Each import saves one worksheet.</p>"
    }<label>Data type<select id="import-kind" ${
      info ? "disabled" : ""
    }><option value="redemption">Redemption report</option><option value="apl" ${
      info?.kind === "apl" ? "selected" : ""
    }>Approval list snapshot (APL)</option><option value="catalog" ${
      info?.kind === "catalog" ? "selected" : ""
    }>Product catalog / attributes</option></select></label>${
      info
        ? `<div class="form-grid" style="margin-top:18px"><label>Worksheet<select id="import-sheet">${info.sheets
            .map(
              (s) =>
                `<option ${s.name === info.sheet ? "selected" : ""}>${esc(
                  s.name
                )}</option>`
            )
            .join(
              ""
            )}</select></label><label>Jurisdiction<input id="import-state" value="${esc(
            info.state
          )}" placeholder="IN, TX, CA…" maxlength="60"></label><label id="period-label">Report period<input id="import-period" value="${esc(
            info.period || ""
          )}" placeholder="2025-Q3 or 2026-07"></label><label>Snapshot observation date (APL only)<input id="import-date" type="date"></label></div><p class="small" style="margin-top:12px">Use the source’s report period. For an APL, enter the date you observed this list. For Texas reports, the parser reads each month from its headers.</p>`
        : `<div class="import-drop"><label for="import-file">XLSX or UTF-8 CSV · up to 20 MB</label><input id="import-file" type="file" accept=".xlsx,.csv"></div><p>Use the CSV templates for other state formats. Catalogs can add manufacturer, flavor, size, category, and product attributes.</p>`
    }<div id="dialog-error" class="error-text" role="alert"></div><div id="import-preview"></div>`,
    info
      ? '<button data-action="preview-import">Check data</button><button class="primary" id="commit-button" data-action="commit-import" disabled>Save to workspace</button>'
      : '<button data-action="templates">Get templates</button><button class="primary" data-action="inspect-import">Continue →</button>'
  );
}
function importOptions() {
  return {
    token: state.import.token,
    sheet: $("#import-sheet").value,
    state: $("#import-state").value,
    period: $("#import-period").value,
    kind: $("#import-kind").value,
    as_of: $("#import-date").value,
  };
}
async function inspectImport() {
  const file = $("#import-file").files[0];
  if (!file) throw Error("Choose a file first.");
  const kind = $("#import-kind").value;
  const result = await api(
    `/import/inspect?name=${encodeURIComponent(file.name)}&kind=${kind}`,
    { method: "POST", body: file }
  );
  importDialog({ ...result, kind });
}
async function previewImport() {
  const result = await api("/import/preview", {
    method: "POST",
    body: JSON.stringify(importOptions()),
  });
  $("#import-preview").innerHTML = `<div class="review"><h3>${num(
    result.count
  )} records ready to import</h3><p>${
    result.total_cents !== undefined ? exact(result.total_cents) + " · " : ""
  }${result.periods.map(period).join(", ")}</p><ul>${result.notes
    .map((n) => `<li>${esc(n)}</li>`)
    .join("")}</ul><details><summary class="small">Preview the first ${
    result.sample.length
  } records</summary><div class="table-wrap"><table class="data-table"><tbody>${result.sample
    .map(
      (r) =>
        `<tr><td>${esc(r.upc || "Aggregate")}</td><td>${esc(
          r.description
        )}</td><td>${
          r.paid_cents !== undefined
            ? exact(r.paid_cents)
            : esc(r.manufacturer || r.category)
        }</td></tr>`
    )
    .join("")}</tbody></table></div></details></div>`;
  $("#commit-button").disabled = false;
  $("#dialog-error").textContent = "";
}
async function commitImport() {
  const result = await api("/import/commit", {
    method: "POST",
    body: JSON.stringify(importOptions()),
  });
  $("#dialog").close();
  if (result.kind === "redemption") {
    state.selected = [result.id];
    state.filters.period = result.periods.at(-1) || "";
    resetFilters(false);
  }
  await load();
  state.view =
    result.kind === "apl"
      ? "approvals"
      : result.kind === "catalog"
      ? "products"
      : "overview";
  location.hash = state.view;
  render();
  notify(
    result.already_exists
      ? "This file is already in the workspace."
      : `${num(result.count)} records saved. Original file retained.`
  );
}
function resetFilters(periodToo = true) {
  for (const k in state.filters)
    if (k !== "period" || periodToo) state.filters[k] = "";
  state.page = 0;
  state.brands = [];
}
async function chooseSources() {
  const reports = state.sources.filter((s) => s.kind === "redemption");
  modal(
    "Choose the report scope",
    `<p>Select reports to combine states or periods. Overlapping reports from the same jurisdiction cannot be combined.</p><div class="checks" style="margin-top:18px">${reports
      .map(
        (s) =>
          `<label class="checkbox-label"><input name="report-check" type="checkbox" value="${
            s.id
          }" ${
            state.selected.includes(s.id) ? "checked" : ""
          }><span><strong>${esc(s.state)} · ${s.periods
            .map(period)
            .join(", ")}</strong> <span class="subline">${esc(
            s.name
          )}</span></span></label>`
      )
      .join(
        ""
      )}</div><div id="dialog-error" class="error-text" role="alert"></div>`,
    '<button data-action="close">Cancel</button><button class="primary" data-action="apply-sources">Apply scope</button>'
  );
}
async function applySources() {
  const ids = [
    ...document.querySelectorAll('[name="report-check"]:checked'),
  ].map((e) => e.value);
  if (!ids.length) throw Error("Select at least one report.");
  const reports = state.sources.filter((s) => ids.includes(s.id));
  const conflict = overlap(reports);
  if (conflict) throw Error(conflict);
  if (reports.reduce((n, s) => n + s.count, 0) > 200000)
    throw Error(
      "Select fewer reports. One view supports up to 200,000 records."
    );
  await Promise.all(ids.map(loadSource));
  state.selected = ids;
  resetFilters();
  $("#dialog").close();
  render();
}
function exportData() {
  if (!exportRows.length) return notify("There are no records to export.");
  const rows = exportRows.map((r) =>
    r.paid_cents !== undefined ? { ...r, paid_amount: r.paid_cents / 100 } : r
  );
  download(`wic-${state.view}.csv`, csv(rows, Object.keys(rows[0])));
  notify("The export includes all filtered records.");
}
function chartExport(trend = false) {
  const groups = trend
    ? group(filtered(), "period").sort((a, b) => a.name.localeCompare(b.name))
    : chartGroups.slice(0, 12);
  if (!groups.length) return;
  const max = Math.max(1, ...groups.map((g) => Math.abs(g.paid_cents)));
  const h = groups.length * 40 + 110;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${h}" viewBox="0 0 900 ${h}"><rect width="900" height="${h}" fill="#fff"/><g font-family="Arial,sans-serif" fill="#20332e"><text x="30" y="34" font-size="20">${
    trend
      ? "Recorded spending over time"
      : "Recorded spending by " +
        (state.view === "brands" ? "brand" : "category")
  }</text><text x="30" y="58" font-size="11">${esc(
    selectedSources()
      .map((s) => s.state + " " + s.periods.join(", "))
      .join(" / ")
  )} · filtered view · USD</text>${groups
    .map(
      (g, i) =>
        `<text x="30" y="${91 + i * 40}" font-size="11">${esc(g.name).slice(
          0,
          55
        )}</text><rect x="350" y="${77 + i * 40}" width="${
          (Math.abs(g.paid_cents) / max) * 400
        }" height="19" rx="3" fill="#386e55"/><text x="865" y="${
          91 + i * 40
        }" text-anchor="end" font-size="11">${exact(g.paid_cents)}</text>`
    )
    .join("")}<text x="30" y="${
    h - 10
  }" font-size="10">Thank you, David · Scope limited to imported source records. Bar lengths show absolute amounts.</text></g></svg>`;
  download("wic-chart.svg", svg, "image/svg+xml");
}
function templates() {
  modal(
    "CSV templates",
    `<p>Product codes must be text. Use one row per product, category, unit, and period. Do not add totals.</p><div class="stack" style="margin-top:20px"><button data-template="redemption">Download redemption template ↓</button><button data-template="apl">Download approval snapshot template ↓</button><button data-template="catalog">Download product catalog template ↓</button></div><p style="margin-top:20px">A catalog supplies product attributes for all imported reports. Each new catalog replaces the previous catalog view. Original catalogs remain in the source library.</p>`,
    '<button data-action="close">Close</button>'
  );
}
const templateData = {
  redemption: [
    [
      "upc",
      "category",
      "subcategory",
      "brand",
      "description",
      "unit",
      "quantity",
      "packages",
      "package_size",
      "paid_amount",
      "period",
    ],
    [
      "00123456789012",
      "Yogurt",
      "Low-fat",
      "Example Brand",
      "Example product",
      "OZ",
      "320",
      "10",
      "32",
      "40.50",
      "2025-Q3",
    ],
  ],
  apl: [
    ["upc", "description", "category", "brand"],
    ["00123456789012", "Example product", "Yogurt", "Example Brand"],
  ],
  catalog: [
    [
      "upc",
      "description",
      "manufacturer",
      "brand",
      "flavor",
      "size",
      "category",
      "attribute",
    ],
    [
      "00123456789012",
      "Example product",
      "Example manufacturer",
      "Example Brand",
      "Plain",
      "32 oz",
      "Yogurt",
      "Low fat",
    ],
  ],
};
async function participation() {
  const weights = await api("/settings/weights");
  modal(
    "Participation weights",
    `<p>Paste CSV with jurisdiction, participant count, and one shared reporting period. Include all jurisdictions in your comparison denominator.</p><p>Example: <code>CA,1000000,2025-09</code></p><label>Counts (one jurisdiction per line)<textarea id="weights" rows="7" style="font:12px monospace;padding:12px;border:1px solid #ccd5c6;border-radius:7px">${esc(
      Array.isArray(weights)
        ? weights.map((w) => `${w.state},${w.count},${w.period}`).join("\n")
        : ""
    )}</textarea></label><label>Source URL or citation<input id="weights-source" value="${esc(
      weights?.[0]?.source || ""
    )}" placeholder="Source and reporting period"></label><p style="margin-top:12px">Coverage counts only watched products. Jurisdictions without an imported APL remain unknown.</p><div id="dialog-error" class="error-text" role="alert"></div>`,
    '<button class="primary" data-action="save-weights">Save weights</button>'
  );
}
async function saveWeights() {
  const citation = $("#weights-source").value.trim();
  if (!citation) throw Error("Add the source for these counts.");
  const rows = $("#weights")
    .value.trim()
    .split("\n")
    .map((line) => {
      const [s, n, p] = line.split(",").map((x) => x.trim());
      if (
        !s ||
        !n ||
        !Number.isFinite(Number(n)) ||
        Number(n) <= 0 ||
        !/^20\d\d-(0[1-9]|1[0-2]|Q[1-4])$/.test(p)
      )
        throw Error(
          "Use jurisdiction, positive participant count, and YYYY-MM or YYYY-Q1."
        );
      return {
        state: s.toUpperCase(),
        count: Number(n),
        period: p,
        source: citation,
      };
    });
  if (
    new Set(rows.map((r) => r.state)).size !== rows.length ||
    new Set(rows.map((r) => r.period)).size !== 1
  )
    throw Error("Use each jurisdiction once and one shared reporting period.");
  await api("/settings/weights", {
    method: "POST",
    body: JSON.stringify(rows),
  });
  $("#dialog").close();
  await showCoverage();
  notify("Participation weights saved.");
}
async function showCoverage() {
  const target = $("#coverage-result");
  if (!target) return;
  const weights = await api("/settings/weights");
  if (!Array.isArray(weights) || !weights.length) return;
  const { byState } = snapshots(state.sources, state.cache);
  const total = weights.reduce((n, r) => n + r.count, 0);
  const missing = weights.filter((w) => !byState.has(w.state));
  target.innerHTML = `<p class="small">${esc(weights[0].period)} · ${num(
    total
  )} participants in ${weights.length} jurisdictions · ${esc(
    weights[0].source
  )}</p>${
    missing.length
      ? `<p class="small">No APL snapshot: ${missing
          .map((w) => esc(w.state))
          .join(", ")}. Coverage below is a known lower bound.</p>`
      : ""
  }${
    state.watch.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Watched UPC</th><th>Known coverage</th></tr></thead><tbody>${state.watch
          .map((upc) => {
            const count = weights.reduce(
              (n, w) =>
                n +
                (byState
                  .get(w.state)
                  ?.at(-1)
                  .records.some((r) => code(r.upc) === upc)
                  ? w.count
                  : 0),
              0
            );
            return `<tr><td>${esc(upc)}</td><td>${pct(count, total)} · ${num(
              count
            )} participants</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<p class="small">Watch a product to calculate its known coverage.</p>'
  }`;
}
function choosePeriods() {
  const periods = unique(allRows(), "period").sort();
  const chosen = Array.isArray(state.filters.period)
    ? state.filters.period
    : state.filters.period
    ? [state.filters.period]
    : periods;
  modal(
    "Select reporting periods",
    `<p>Select the periods to include. Monthly and quarterly periods keep their source labels.</p><div class="checks" style="margin-top:18px">${periods
      .map(
        (p) =>
          `<label class="checkbox-label"><input type="checkbox" name="period-check" value="${p}" ${
            chosen.includes(p) ? "checked" : ""
          }>${period(p)}</label>`
      )
      .join(
        ""
      )}</div><div id="dialog-error" class="error-text" role="alert"></div>`,
    '<button data-action="close">Cancel</button><button class="primary" data-action="apply-periods">Apply periods</button>'
  );
}
async function monitorSettings() {
  const m = await api("/monitor");
  modal(
    "Automatic source checks",
    `<p>Checks run while this local server is active. New files become snapshots. Existing reports remain unchanged. Alerts appear in the approval monitor.</p><label>Check interval<select id="monitor-hours"><option value="0" ${
      m.config.hours === 0 ? "selected" : ""
    }>Off · manual downloads only</option><option value="6" ${
      m.config.hours === 6 ? "selected" : ""
    }>Every 6 hours</option><option value="24" ${
      m.config.hours === 24 ? "selected" : ""
    }>Every 24 hours</option></select></label><div class="checks" style="margin-top:18px">${[
      ["ca", "California approval list"],
      ["tx", "Texas peanut and seed butter"],
    ]
      .map(
        ([k, n]) =>
          `<label class="checkbox-label"><input type="checkbox" name="monitor-source" value="${k}" ${
            m.config.sources.includes(k) ? "checked" : ""
          }>${n}</label>`
      )
      .join("")}</div>${Object.entries(m.status)
      .map(
        ([k, v]) =>
          `<p style="margin-top:12px">${esc(k.toUpperCase())}: ${esc(
            v.result
          )} · ${new Date(v.checked_at).toLocaleString()}<br>${esc(
            v.error
          )}</p>`
      )
      .join("")}<div id="dialog-error" class="error-text" role="alert"></div>`,
    '<button data-action="check-now">Check saved sources now</button><button class="primary" data-action="save-monitor">Save settings</button>'
  );
}
async function action(name) {
  switch (name) {
    case "choose-periods":
      choosePeriods();
      break;
    case "apply-periods": {
      const periods = [
        ...document.querySelectorAll('[name="period-check"]:checked'),
      ].map((e) => e.value);
      if (!periods.length) throw Error("Select at least one period.");
      state.filters.period = periods;
      state.page = 0;
      $("#dialog").close();
      render();
      break;
    }
    case "monitor-settings":
      await monitorSettings();
      break;
    case "save-monitor": {
      const sources = [
        ...document.querySelectorAll('[name="monitor-source"]:checked'),
      ].map((e) => e.value);
      if (!sources.length) throw Error("Select at least one source.");
      await api("/monitor", {
        method: "POST",
        body: JSON.stringify({
          hours: Number($("#monitor-hours").value),
          sources,
        }),
      });
      $("#dialog").close();
      notify("Automatic check settings saved.");
      break;
    }
    case "check-now": {
      notify("Checking saved public sources…");
      await api("/monitor/check", { method: "POST" });
      await load();
      render();
      await monitorSettings();
      break;
    }
    case "close":
      $("#dialog").close();
      break;
    case "import":
      importDialog();
      break;
    case "inspect-import":
      await inspectImport();
      break;
    case "preview-import":
      await previewImport();
      break;
    case "commit-import":
      await commitImport();
      break;
    case "choose-sources":
      await chooseSources();
      break;
    case "apply-sources":
      await applySources();
      break;
    case "export":
      exportData();
      break;
    case "export-chart":
      chartExport();
      break;
    case "export-prices": {
      const rows = filtered().filter((r) => r.packages > 0 && r.unit !== "$$$");
      const result = group(rows, "brand_key").map((g) => ({
        brand: g.name,
        weighted_price:
          g.paid_cents / 100 / g.rows.reduce((n, r) => n + r.packages, 0),
        category: g.rows[0].category,
        size: g.rows[0].size,
        unit: g.rows[0].unit,
      }));
      download(
        "wic-prices.csv",
        csv(result, ["brand", "weighted_price", "category", "size", "unit"])
      );
      break;
    }
    case "export-trend":
      chartExport(true);
      break;
    case "reset":
      resetFilters();
      render();
      break;
    case "templates":
      templates();
      break;
    case "participation":
      await participation();
      break;
    case "save-weights":
      await saveWeights();
      break;
    case "add-watch":
      modal(
        "Watch a product",
        '<p>Use the UPC from the product label or source file. The approval monitor will show its listings and snapshot changes.</p><label>Product code<input id="watch-upc" inputmode="numeric" placeholder="UPC or PLU"></label><div id="dialog-error" class="error-text" role="alert"></div>',
        '<button class="primary" data-action="commit-watch">Watch product</button>'
      );
      break;
    case "commit-watch": {
      const upc = $("#watch-upc").value.trim();
      if (!/^\d{4,18}$/.test(upc))
        throw Error("Enter a code with 4 to 18 digits.");
      if (!state.watch.includes(code(upc))) state.watch.push(code(upc));
      await api("/settings/watchlist", {
        method: "POST",
        body: JSON.stringify(state.watch),
      });
      $("#dialog").close();
      render();
      await showCoverage();
      break;
    }
    case "save-view":
      modal(
        "Save this view",
        '<p>Save the report selection, filters, and current page.</p><label>View name<input id="view-name" maxlength="80" placeholder="e.g. Indiana yogurt review"></label><div id="dialog-error" class="error-text" role="alert"></div>',
        '<button class="primary" data-action="commit-view">Save view</button>'
      );
      break;
    case "commit-view": {
      const name = $("#view-name").value.trim();
      if (!name) throw Error("Give this view a name.");
      state.views.push({
        name,
        selected: [...state.selected],
        filters: { ...state.filters },
        view: state.view,
      });
      await api("/settings/views", {
        method: "POST",
        body: JSON.stringify(state.views),
      });
      $("#dialog").close();
      notify("View saved. Open it from Data sources.");
      break;
    }
  }
}
document.addEventListener("click", async (event) => {
  const el = event.target.closest("button,a");
  if (!el) return;
  try {
    if (el.dataset.nav) {
      const v = el.dataset.nav;
      if (v === state.view && v === "products") resetFilters();
      state.view = v;
      state.page = 0;
      location.hash = v;
      render();
      if (v === "approvals") await showCoverage();
      return;
    }
    if (el.dataset.action) {
      const original = el.innerHTML;
      if (
        [
          "inspect-import",
          "preview-import",
          "commit-import",
          "apply-sources",
        ].includes(el.dataset.action)
      ) {
        el.disabled = true;
        el.textContent = "Working…";
        try {
          await action(el.dataset.action);
        } finally {
          if (el.isConnected) {
            el.disabled = false;
            el.innerHTML = original;
          }
        }
      } else await action(el.dataset.action);
      return;
    }
    if (el.dataset.live) {
      el.disabled = true;
      el.textContent = "Fetching public source…";
      try {
        const result = await api("/live/" + el.dataset.live, {
          method: "POST",
        });
        importDialog(result);
      } finally {
        render();
      }
      return;
    }
    if (el.dataset.source) {
      sourceDetails(el.dataset.source);
      return;
    }
    if (el.dataset.product) {
      productDetails(Number(el.dataset.product));
      return;
    }
    if (el.dataset.watch) {
      const id = code(el.dataset.watch);
      state.watch = state.watch.includes(id)
        ? state.watch.filter((x) => x !== id)
        : [...state.watch, id];
      await api("/settings/watchlist", {
        method: "POST",
        body: JSON.stringify(state.watch),
      });
      render();
      if (state.view === "approvals") await showCoverage();
      return;
    }
    if (el.dataset.filterValue) {
      state.filters[el.dataset.filterKey] = el.dataset.filterValue;
      state.page = 0;
      render();
      return;
    }
    if (el.dataset.sort) {
      if (state.sort === el.dataset.sort) state.direction *= -1;
      else {
        state.sort = el.dataset.sort;
        state.direction = -1;
      }
      render();
      return;
    }
    if (el.dataset.page) {
      state.page = Math.max(0, Number(el.dataset.page));
      render();
      return;
    }
    if (el.dataset.aplTab) {
      state.aplTab = el.dataset.aplTab;
      state.page = 0;
      render();
      await showCoverage();
      return;
    }
    if (el.dataset.template) {
      const [headers, values] = templateData[el.dataset.template];
      download(
        "wic-" + el.dataset.template + "-template.csv",
        csv(
          [Object.fromEntries(headers.map((k, i) => [k, values[i]]))],
          headers
        )
      );
      return;
    }
    if (el.dataset.saved) {
      const v = state.views[Number(el.dataset.saved)];
      state.selected = v.selected;
      state.filters = { ...state.filters, ...v.filters };
      state.view = v.view;
      await Promise.all(state.selected.map(loadSource));
      location.hash = state.view;
      render();
    }
  } catch (error) {
    errorInDialog(error);
  }
});
document.addEventListener("change", async (event) => {
  const el = event.target;
  try {
    if (el.dataset.filter && el.dataset.filter !== "q") {
      state.filters[el.dataset.filter] = el.value;
      state.page = 0;
      render();
    }
    if (el.dataset.compare) {
      const b = el.dataset.compare;
      if (el.checked && state.brands.length >= 3) {
        el.checked = false;
        return notify("Select up to three brands.");
      }
      state.brands = el.checked
        ? [...state.brands, b]
        : state.brands.filter((x) => x !== b);
      render();
    }
    if (el.id === "only-watch") {
      state.onlyWatched = el.checked;
      state.page = 0;
      render();
      await showCoverage();
    }
    if (
      ["import-sheet", "import-state", "import-period", "import-date"].includes(
        el.id
      ) &&
      $("#commit-button")
    ) {
      $("#commit-button").disabled = true;
      $("#import-preview").innerHTML = "";
    }
  } catch (error) {
    errorInDialog(error);
  }
});
let searchTimer;
let pointerIsDown = false;
document.addEventListener(
  "pointerdown",
  () => {
    pointerIsDown = true;
  },
  true
);
document.addEventListener(
  "pointerup",
  () => {
    pointerIsDown = false;
  },
  true
);
document.addEventListener(
  "pointercancel",
  () => {
    pointerIsDown = false;
  },
  true
);
document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.filter === "q" || el.id === "apl-search") {
    clearTimeout(searchTimer);
    const applySearch = () => {
      if (pointerIsDown || el.isComposing) {
        searchTimer = setTimeout(applySearch, 40);
        return;
      }
      if (el.id === "apl-search") state.aplSearch = el.value;
      else state.filters.q = el.value;
      state.page = 0;
      render();
      if (state.view === "approvals")
        showCoverage().catch((e) => notify(e.message));
    };
    searchTimer = setTimeout(applySearch, 160);
  }
  if (
    ["import-state", "import-period", "import-date"].includes(el.id) &&
    $("#commit-button")
  )
    $("#commit-button").disabled = true;
});
window.addEventListener("hashchange", () => {
  state.view = location.hash.slice(1) || "overview";
  state.page = 0;
  render();
  if (state.view === "approvals")
    showCoverage().catch((e) => notify(e.message));
});
load()
  .then(() => {
    const periods = unique(allRows(), "period").sort();
    state.filters.period = periods.at(-1) || "";
    render();
    if (state.view === "approvals")
      showCoverage().catch((e) => notify(e.message));
  })
  .catch((error) => {
    $(
      "#app"
    ).innerHTML = `<main class="empty"><h1>The workspace could not load</h1><p>${esc(
      error.message
    )}</p><a href="/">Try again</a></main>`;
  });

// Refresh visible data after an optional background source check.
setInterval(async () => {
  if (document.hidden || $("#dialog").open) return;
  try {
    const next = await api("/sources");
    if (
      next.map((s) => s.id).join() !== state.sources.map((s) => s.id).join()
    ) {
      await load();
      render();
      notify(
        "A new source snapshot is available. Review the approval monitor."
      );
    }
  } catch {}
}, 60000);
