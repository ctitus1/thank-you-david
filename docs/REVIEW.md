# Review record

Review date: November 19, 2026.

## Validation

- The Indiana import contains 5,293 records across 12 categories. Payments reconcile to $20,352,871.81.
- The Texas import contains 108 records across three months. Each month reconciles to the published grand total.
- The California public download contains 6,837 UPC records.
- The automated suite covers 26 data and browser tests with a separate test database.
- The browser tests cover search, provenance, exports, scope conflicts, saved views, imports, approvals, weights, keyboard dismissal, and a search refresh during a product click.
- Desktop checks used a 1440-pixel viewport. Mobile checks used a 390-pixel viewport with the supplied workbook.
- All six screens passed the horizontal overflow check at the mobile width.
- Axe-core 4.10.3 reported zero WCAG A/AA violations on the six screens and the initial import dialog.

Automated accessibility checks are not an accessibility certification. Manual checks covered keyboard focus, dialog dismissal, readable tables, and responsive navigation.

## Design decisions

The interface uses an off-white workspace, restrained green accents, and a persistent navigation rail. Tables retain exact values beside rounded summary totals.

Charts use visible numeric labels. Long product tables scroll inside their panel on small screens. The page itself remains within the viewport.

The interface labels report coverage, missing brands, unspecified attributes, unavailable snapshots, and the denominator for shares.

## Reliability decisions

Imports require a preview before the interface enables saving. The API validates the file again at commit time.

Duplicate files return the existing source. Invalid imports stop without replacing saved data. Source downloads retain previous snapshots when a fetch fails.

The app checks redirected download hosts and paths. California’s official download redirects to a specific public S3 resource.

Files and reports stay outside Git. The SQLite backup endpoint creates a consistent database copy, including pending journal data.

Automatic source checks remain off by default. When enabled, they run only while the local server is active.

## Remaining limits

The automatic source collection covers Texas peanut and seed butter reports and California UPC lists. Other jurisdictions require normalized files or additional adapters.

The product catalog and participation weights require user-supplied evidence. The app does not infer manufacturer ownership or participant counts.

The app does not establish full parity with Lulo’s private service or its nationwide data collection. The public workflow mapping appears in CAPABILITIES.md.

Plain-language lint scores, measured as findings per 100 words: README 0.34, capability comparison 0.63.

Review-record lint score: 0.00 findings per 100 words.

## Standalone HTML review

The shared file embeds three sources and 12,238 normalized records. Its size is approximately 3.2 MiB.

The file includes all styles, scripts, and icons. Original workbook binaries and automatic check settings remain outside the shared file.

Browser checks opened the file with networking disabled. All six screens worked. No HTTP requests or JavaScript errors occurred.

A renamed copy opened in a fresh browser context. It retained the selected view, filters, saved views, and watched products.

Tests cover CSV exports, chart exports, source details, mobile layout, embedded data escaping, and the HTML download endpoint.

The full suite passes 33 tests. The local server remains stopped after the checks.

Sharing instructions received a plain-language lint score of 0.80 findings per 100 words.

Standalone review lint score: 0.00 findings per 100 words.
