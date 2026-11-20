# Thank you, David

A local workspace for WIC redemption analysis and product approval monitoring.

## Start

```bash
cd /home/user/thank-you-david
./run.sh
```

Open http://127.0.0.1:8765. The server binds to the local machine. Python 3.10 or later is required.

On a fresh checkout, the script creates a virtual environment and installs the runtime dependencies. Later starts work offline.

The source library in this workspace contains:

| Source | Coverage | Records |
| --- | --- | ---: |
| Supplied Indiana workbook | Q3 2025, 12 selected categories | 5,293 |
| Texas public report | Peanut and seed butter, May–July 2026 | 108 |
| California public APL | UPC snapshot observed on the download date | 6,837 |

The database and original files remain local and outside Git. A fresh checkout starts empty.

To import the supplied workbook again:

```bash
./run.sh --import-file '/home/user/Downloads/2025 1009 IN WIC Redemption 3Q 2025.xlsx'
```

An identical import returns the existing source. Other files can use `--state` and `--period`, or the import dialog.

## Main tasks

1. Open **Overview** to inspect spending and report coverage.
2. Open **Products** to search codes, inspect prices, and trace records to source rows.
3. Open **Brands & share** to compare brands within the current scope.
4. Open **Approval monitor** to compare dated lists, watch codes, and inspect changes.
5. Open **Data sources** to import files, fetch public data, set automatic checks, and restore saved views.

The report selector combines jurisdictions or periods. It blocks overlapping reports within one jurisdiction. Choose individual periods with **Select periods**.

A product catalog supplies manufacturer, flavor, size, category, and attributes such as whole grain. The latest imported catalog supplies the active attributes.

The approval matrix includes catalog products absent from every imported APL. Brand coverage uses the product catalog as its denominator.

Participation weights require a source citation and counts from one reporting period. Missing APL snapshots produce a labeled lower bound.

## File formats

Download example CSV templates from **Data sources**. Template rows are examples, not observations.

| Type | Required columns | Optional columns |
| --- | --- | --- |
| Redemption | `upc`, `category`, `description`, `paid_amount` | `period`, `brand`, `subcategory`, `unit`, `quantity`, `packages`, `package_size` |
| APL | `upc` | `description`, `category`, `subcategory`, `brand`, `unit` |
| Catalog | `upc` | `description`, `manufacturer`, `brand`, `flavor`, `size`, `category`, `attribute` |

Redemption periods use `YYYY-MM` or `YYYY-Q1` through `YYYY-Q4`. Supply a period column or enter a period during import.

Each APL import requires a jurisdiction and observation date. This date records the snapshot, not the official approval date.

Keep product codes as text. The app retains their source form. Cross-source joins ignore leading zeros.

CSV exports retain the original code strings. When opening exports in Excel, import the code column as text to retain leading zeros.

XLSX imports read cached cell values. Recalculate formulas in a spreadsheet editor before import if cached results are missing.

Limits: 20 MB per file, 120 MB expanded workbook size, 50,000 parsed records per source, and 200,000 records per combined view.

## Public downloads

The adapters discover download links on official pages:

- [Texas WIC redemption reports](https://www.hhs.texas.gov/providers/wic-providers/wic-vendor-management-operations-unit): peanut and seed butter reports, including anonymous private-label aggregates.
- [California APL dataset](https://data.ca.gov/@california-department-of-public-health/california-wic-authorized-product-list): UPC lists.

Texas imports reconcile each month against the published grand total. A changed format or failed download stops the import and preserves saved data.

Automatic checks are off by default. Enable checks every 6 or 24 hours in **Data sources → Automatic checks**.

Checks run while the local server is active. Changed files create new snapshots. Alerts appear in the app for watched codes.

Public reports have publication delays. A fresh download does not imply current transactions or current purchase eligibility.

Other jurisdictions use the documented import format. A new public source needs an adapter and a representative test fixture.

## Data rules

- Sum integer cents after rounding each source row. Retain negative adjustments.
- Keep missing quantities distinct from zero. Retain original units.
- Calculate share against the selected records, and label that denominator.
- Calculate package prices from total paid amount divided by reported packages.
- Compare package prices only within one category, size, and unit.
- Keep report periods intact. Do not interpolate missing periods or annualize quarterly totals.
- Import one worksheet. Reject duplicate product keys and invalid numeric values.
- Keep original files, checksums, worksheet names, and row numbers.

The Indiana query excludes some categories, including infant formula. Its $20,352,871.81 total is not total Indiana WIC spending.

An APL listing describes a dated file. Absence does not prove ineligibility. [California explains limitations of its published APL](https://www.cdph.ca.gov/Programs/CFH/DWICSN/Pages/WICFoods/CAWICAPL.aspx).

## Maintenance

The runtime uses FastAPI, SQLite, openpyxl, httpx, and defusedxml. The browser uses native JavaScript, CSS, and HTML. There is no frontend build step.

| File | Responsibility |
| --- | --- |
| `app/ingest.py` | Redemption adapters, validation, and reconciliation |
| `app/catalog.py` | APL and product catalog imports |
| `app/store.py` | SQLite storage, original files, and import identity |
| `app/live.py` | Public link discovery and restricted downloads |
| `app/monitor.py` | Optional scheduled checks |
| `app/main.py` | Local HTTP API, CLI, and request controls |
| `app/static/analytics.js` | Filtering, grouping, comparisons, and exports |
| `app/static/app.js` | Views and user actions |
| `app/static/style.css` | Layout, typography, responsive styles, and print styles |

Set `WIC_DB` to change the database location. The default is `data/wic.sqlite3`.

Download a consistent backup from **Data sources → Back up workspace**. To restore, stop the server and start it with `WIC_DB` pointing to the backup.

The server enforces local host names, same-origin writes, a request header, and a content security policy. Downloads use an explicit host and path allowlist.

This is a local, single-user application. Remote access would require authentication, authorization, and a separate deployment review.

## Tests

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/playwright install chromium
./test.sh -q
```

The browser tests use a separate temporary database. The test runner disables unrelated globally installed pytest plugins.

Tests cover import validation, monetary totals, duplicate handling, provenance, overlapping scopes, exports, approval changes, saved views, and mobile layout.

See [the capability comparison](docs/CAPABILITIES.md) for the public Lulo feature mapping and coverage limits.
