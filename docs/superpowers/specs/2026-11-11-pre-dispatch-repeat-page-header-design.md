# Repeat Delivery Header on Every Printed Page

## Intent

Keep each continuation page identifiable and prevent delivery details from appearing detached from their Trip. The Trip header, Ship To/Location summary, and table headings must repeat whenever a printed table continues onto another A4 page.

## Goals

- Repeat the complete document header on every physical page for Trip and Ship To print modes.
- Keep every Ship To group and item row in the generated output; do not silently drop data at page breaks.
- Keep signatures at the bottom of each page within the paper edge.
- Preserve fixed A4 column widths and long-value wrapping.
- Show the Trip Ship To count and document count consistently on each page.

## Non-goals

- Change which Trips or picking-list rows TMS returns.
- Write any data back to TMS or change the existing Orders/POD documents.
- Change Trip numbering or merge Trips across warehouses.

## Approaches

1. Put the full header in the repeating table `thead`.
2. **Selected: reserve a fixed print header on every page.** The supplied long Trip preview showed Chromium did not reliably repeat a large `thead`. Pin Trip metadata and Ship To/Location at the top of each printed page, reserve that height in the A4 page margin, and let the compact table `thead` repeat column labels.
3. Split rows into manually sized page sections. This duplicates header markup but requires estimating rendered heights and can fail for long values, so it is not selected.

## Constraints and verification

- Keep the existing 6-column widths totaling 100%, wrapping behavior, A4 size, and side-by-side signatures.
- Render all Ship To groups from TMS data once; the fixed header must not duplicate item rows or totals.
- Verify each page visually and compare distinct Ship To groups, distinct Shipment IDs, and quantity totals against the same Trip and warehouse in TMS.
- The supplied PDF contains 6 Ship To groups across 2 pages, but the current TMS page shows a different warehouse and row count for Trip `20261111001`; do not claim the PDF matches the current TMS snapshot until that discrepancy is resolved.

