# Pre-dispatch delivery documents

## Intent

Add a separate menu for printing delivery documents before a trip leaves the warehouse. Keep the existing POD-based delivery document unchanged.

## Goals

- Read current Trip and picking-list data directly from the company TMS when the new page loads.
- List trips that have not left the warehouse: TMS statuses `Confirm` (2) and `Handling` (3). Exclude `OnDelivery` and later statuses, plus cancelled trips.
- Offer three print actions: one document containing the whole Trip, one print job with a separate document for every Ship To, or one document for a selected Ship To.
- Show a document type summary on the pre-print page for each Trip and expanded Ship To, inferred from Shipment ID prefixes.
- Reuse the existing consignment document's visual style and available Trip / Ship to / item data.
- Remove POD signature images, delivery photos, and delivery collection timestamps from this pre-dispatch document.
- Show two blank signing areas at the bottom, side by side: `ผู้ตรวจเช็ค` on the left and `Consignee` on the right.
- Keep document type labels off the printable A4; they are only for the pre-print page.

## Proposed flow

1. An office user opens the new `พิมพ์ใบส่งสินค้า` menu.
2. The page reads Trip headers and picking-list details directly from TMS for the allowed warehouses and selected date range (default: today), across carrier types.
3. The page groups rows by Trip and Ship To. It shows the Trip number, date, warehouse, status, Ship To count, and document type inferred from every Shipment ID in the Trip.
4. Expanding a Trip shows each Ship To's address, Shipment/item count, and document type inferred from that Ship To's Shipment IDs.
5. The user can choose `พิมพ์ทั้ง Trip` for one document containing every Ship To, `พิมพ์แยกทั้งหมด` for one print job with a separate document per Ship To, or `พิมพ์ Ship To นี้` for the selected Ship To. Long content may continue onto additional pages as needed.
6. Printing uses the browser's print dialog, consistent with the existing document.

## Document type rules

- Trim and compare Shipment ID prefixes without case sensitivity.
- `PL` maps to `Dealer`; `BK` maps to `Transfer`.
- If the Trip or Ship To contains both prefixes, show `Dealer + Transfer`.
- If no recognized prefix exists, show `ไม่ระบุ`.
- Calculate Trip type from all Trip rows and Ship To type from that group's rows.
- Display these labels on the pre-print page only; do not add them to the printable A4.

## Document contents

- Trip header: Trip number, date, warehouse, area, driver / vehicle details when returned by TMS, and shipment count.
- Ship to section: recipient name, address and available location, picking-list number, item code/name, box size, and quantity.
- A4 layout based on the existing consignment print style; no document type label is printed.
- Two empty signature lines, `ผู้ตรวจเช็ค` and `Consignee`, clearly separated left and right.
- No POD images, POD signature, recipient name captured at delivery, or delivery timestamp.

If TMS does not return a value for a field, show `—` rather than inventing a value. Use a known customer pin for location only when an unambiguous match is available; otherwise show `—`.

## Approaches considered

1. Read live from TMS when opening the page — selected. This supports pre-dispatch status and current picking-list details, using the existing TMS gateway read path. Users need an active TMS session.
2. Read the mirrored `tms_trips` / `tms_shipments` data — not selected. This uses the local app session but can be stale and depends on the previous sync containing the trip.
3. Build from existing orders — unsuitable for this timing because order creation is gated until TMS reaches `OnDelivery`.

## Boundaries

- Add a new menu, route, page, and print template. Any edits to the existing navigation/router are additive wiring only.
- Do not change the existing Orders PDF, POD flow, TMS import behavior, or trip state transitions.
- The new menu is read-only; it does not write to TMS or Supabase.
- Reuse the existing dispatch visibility permission for the route and menu.

## Open implementation detail

Confirm that the TMS payload contains the expected driver and vehicle fields for pre-dispatch trips. If absent, keep those fields as `—`; do not fall back to a different trip with the same Trip number.
