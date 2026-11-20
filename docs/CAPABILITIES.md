# Capability comparison

Reference: [Lulo WIC Data Tools](https://www.hellolulo.com/wic-tools), reviewed November 19, 2026.

This app implements the workflows below from Lulo’s public feature list. Public descriptions cannot establish parity with undisclosed private features.

| Public capability | Local implementation | Required data |
| --- | --- | --- |
| Redemption dashboards | Overview, product table, category chart, and source details | Imported reports |
| Manufacturer, brand, flavor, and size filters | Product filters with catalog enrichment | Catalog for attributes absent from reports |
| Category attributes | Category and attribute filters, including whole grain when supplied | Catalog attribute column |
| State and combined geography analysis | Jurisdiction selection, combined reports, and period selection | Reports for the selected jurisdictions |
| Share, trends, and pricing | Brand comparison, reported-period charts, and weighted package prices | Comparable coverage and package counts |
| Chart and data exports | SVG charts, filtered CSV files, originals, and database backup | Current view |
| Approval tracking by UPC | Matrix across imported jurisdiction snapshots | Dated APL files |
| Brand and UPC gaps | Catalog products absent from snapshots, with unknown coverage labeled | Product catalog and APL files |
| Competitor comparisons | Brand coverage table and product matrix | Competitor products in the catalog |
| Sales-team approval views | Exportable jurisdiction matrix | Current snapshots |
| Participation coverage | Weighted coverage for watched products | Cited counts from one reporting period |
| Alerts | Watched UPC changes and optional source checks | Two snapshots of a jurisdiction |

## Boundaries

The app does not reproduce Lulo’s nationwide data collection or proprietary enrichment. Its automatic adapters cover two public sources.

Additional jurisdictions work through the import templates. Manufacturer and flavor data require a supplied catalog. Participant counts require a cited source.

Importing more jurisdictions does not make the available records a representative national estimate. Report scope, categories, units, and dates can differ.

The consumer Lulo app is a separate product. Personal EBT balances, family accounts, shopping recommendations, and community resources are outside this data-tool project.

A claim that this app matches every Lulo capability would require access to its complete current specification and a broader source-coverage review.
