# Pre-dispatch delivery documents

## Intent

Add a separate menu for printing delivery documents before a trip leaves the warehouse. Keep the existing POD-based delivery document unchanged.

## Goals

- Read current Trip and picking-list data directly from the company TMS when the new page loads.
- List trips that have not left the warehouse: TMS statuses `Confirm` (2) and `Handling` (3). Exclude `OnDelivery` and later statuses, plus cancelled trips.
- Print either one A4 PDF for the whole Trip or one A4 PDF for an individual Ship to.
- Reuse the existing consignment document's visual style and available Trip / Ship to / item data.
- Remove POD signature images, delivery photos, and delivery collection timestamps from this pre-dispatch document.
- Show two blank signing areas at the bottom, side by side: `ผู้ตรวจเช็ค` on the left and `Consignee` on the right.

## Proposed flow

1. An office user opens the new `พิมพ์ใบส่งสินค้า` menu.
2. The page reads Trip headers and picking-list details directly from TMS for the allowed warehouses and selected date range (default: today), across carrier types.
3. The page groups rows by Trip and Ship to. It shows the Trip number, date, warehouse, status, Ship to count, and item/PL count.
4. The user opens a Trip and chooses `พิมพ์ทั้ง Trip` to print one document with a separate A4 page starting each Ship to, or chooses `พิมพ์ Ship to นี้` to print only that Ship to as one PDF. A Ship to with too many item rows may continue onto additional pages.
5. Printing uses the browser's print dialog, consistent with the existing document. Each individual Ship to is printed with its own action.

## Document contents

- Trip header: Trip number, date, warehouse, area, driver / vehicle details when returned by TMS, and shipment count.
- Ship to section: recipient name, address and available location, picking-list number, item code/name, box size, and quantity.
- A4 page layout based on the existing consignment print style.
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
