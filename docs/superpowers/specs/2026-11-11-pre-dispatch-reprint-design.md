# Pre-Dispatch Document Reprint Design

## Intent

Allow office and warehouse users to reprint a delivery document after a Trip has been confirmed, using a dedicated menu so the existing before-dispatch flow remains focused on Trips that have not yet left the warehouse.

## User flow

1. Open **พิมพ์ใบส่งสินค้า (ย้อนหลัง)**.
2. Choose a date range and optionally a warehouse, then search. Search by Trip number within the returned range.
3. Select a Trip in Confirm, Handling, OnDelivery, or Completed status.
4. Load that Trip's shipment details from TMS and print the whole Trip, all Ship To documents, or one Ship To.

## Data and behavior

- Read current Trip headers and shipment rows from TMS when the user searches/selects; write nothing to TMS or app storage.
- Exclude Cancelled and pre-confirmation statuses.
- Load shipment detail rows only for the selected Trip to avoid querying every historical Trip on page load.
- Preserve existing A4 document layout and PL/BK document type display behavior.
- Show that reprint uses current TMS data; it is not a frozen copy of the values at confirmation time.
- Scan at most 60 pages per warehouse. If the TMS scan reports it did not finish before this cap, show a visible prompt to narrow the date range.
- If TMS has no detail rows for the selected Trip, keep the print actions unavailable and explain that the document rows could not be loaded.

## Scope

- Add a separate authenticated menu and route.
- Reuse the current read-only print templates.
- Add a bounded historical Trip-header scan and a selected-Trip detail loader.
- Do not alter the existing pre-dispatch menu, Trip status, POD, Orders, or database records.

## Verification

- Cloud build/typecheck succeeds.
- Review the new page flow and code paths for date/warehouse filtering, cancelled status exclusion, scan-cap messaging, and no TMS writes.
- Historical data totals may differ from the attached PDF; the menu makes no claim that today's TMS response recreates a past snapshot.

