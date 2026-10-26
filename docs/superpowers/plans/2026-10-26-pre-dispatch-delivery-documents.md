# Pre-dispatch Delivery Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only TMS menu that prints an A4 delivery document for a full pre-dispatch Trip or one Ship to, with blank checker and consignee signature areas.

**Architecture:** Add a scan API dedicated to pre-dispatch printing so the existing label scan contract does not change. Add a pure HTML document builder and a page that loads current trips on entry, then wire an additive route and navigation link guarded by `dispatch.view`.

**Tech Stack:** React, TypeScript, Vite, Vitest, existing `tmsOp` TMS gateway and browser print dialog.

**Spec:** `docs/plans/2026-10-26-pre-dispatch-delivery-documents-design.md`

## Global Constraints

- Read directly from TMS when opening the new menu; do not write to TMS or Supabase.
- Include only statuses `Confirm` (2) and `Handling` (3); exclude all other states.
- Keep the existing Orders PDF, POD flow, TMS import, and trip state transitions unchanged.
- Print one A4 page per Ship to, either as one whole-Trip document or one Ship-to document.
- Leave blank side-by-side signing areas: `ผู้ตรวจเช็ค` on the left and `Consignee` on the right.
- Reuse `dispatch.view` permission.

## Review Focus

- TMS rows may contain HTML metacharacters — test HTML escapes user-controlled values.
- Missing optional Trip / Ship-to fields — test that the document uses `—` and renders no fabricated location.
- Unexpected or missing status ids — test that only 2 and 3 are included.
- A Trip with no picking-list rows — test that it is not offered for printing.
- A long item list — test print CSS starts each Ship to on a new page and allows continuation.

---

### Task 1: TMS pre-dispatch scan contract

**Files:**
- Modify: `web/src/api/tmsPull.ts`
- Test: `web/src/api/tmsPull.test.ts` (locate existing API test pattern before adding)

**Interfaces:**
- Produces: `PreDispatchTmsTrip` with Trip header fields (id, tripNo, orderDate, statusId, status, warehouse, area, driver, licensePlate, vehicleTypeName, carrierName) and normalized `PlRow[]`; `scanTripsForPreDispatch(opts: {from:string; to:string; warehouse:Warehouse; maxPages?:number}): Promise<PreDispatchTmsTrip[]>`.

- [x] Write tests for allowed statuses, date range, optional header fields, and row normalization; verify tests fail before implementation.
- [x] Implement a separate TMS scanner reusing `toTripHeader`, the existing 60-id `scanTripPickingLists` batching, and `plRowsOf`; retain only status 2/3 and requested dates.
- [x] Run the focused API tests; verify existing `scanTripsForLabels` behavior remains unchanged.

### Task 2: A4 pre-dispatch document builder

**Files:**
- Create: `web/src/utils/preDispatchDocument.ts`
- Create: `web/src/utils/preDispatchDocument.test.ts`

**Interfaces:**
- Consumes: `PreDispatchTmsTrip` from Task 1.
- Produces: `preDispatchTripHtml(trip, logoUrl): string`, `preDispatchShipToHtml(trip, shipToName, logoUrl): string`, and `printPreDispatchHtml(html): boolean`.

- [x] Write failing tests for escaped text, missing values, two separate signature columns, no POD fields, and page breaks between Ship-to groups.
- [x] Implement a focused Ship-to grouping helper and standalone A4 HTML using Trip, PL, item, quantity and available address fields; create print buttons via `window.open` and `window.print`.
- [x] Run focused tests and typecheck.

### Task 3: Page, route and menu

**Files:**
- Create: `web/src/pages/CloudDeliveryDocuments.tsx`
- Modify: `web/src/AppCloud.tsx`
- Modify: `web/src/components/CloudLayout.tsx`

**Interfaces:**
- Consumes: Task 1 scan function and Task 2 builder/print function.
- Produces: `/delivery-documents` menu page protected by `dispatch.view`.

- [x] Implement date filters defaulted to today, live warehouse lookup and TMS scan on page entry/date change; show loading/error/empty states and trip rows.
- [x] Add controls for whole Trip print and per-Ship-to print, showing `Confirm`/`Handling` state and Trip/Ship-to summary.
- [x] Wire additive lazy route and navigation item; leave existing Orders and label routes untouched.
- [x] Run focused tests, all web tests, typecheck and cloud build.

### Task 4: Production release

**Files:**
- Modify: implementation files from Tasks 1–3.

- [x] Review diff against the design and verify no existing document/POD path changed.
- [ ] Fetch origin and confirm target branch still has the expected base and no conflicting updates.
- [ ] Push the verified implementation to the production branch as authorized by Wave; observe the production deployment/checks to completion.
- [ ] Record commit, deployment status and final verification results.
