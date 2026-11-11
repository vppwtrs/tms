# Pre-Dispatch Document Reprint Implementation Plan

> **For agentic workers:** Use this plan task by task; keep the historical menu separate from the before-dispatch menu.

**Goal:** Reprint an already-confirmed Trip using current TMS data without changing the Trip or shipment records.

**Architecture:** Add a separate permission-protected menu and page. Search bounded Trip headers by date and warehouse, filter to confirmed-or-later non-cancelled statuses, and load shipment rows only after the user selects one Trip. Reuse the existing A4 print templates.

**Tech Stack:** React, TypeScript, existing TMS gateway, existing print utility.

**Spec:** `docs/superpowers/specs/2026-11-11-pre-dispatch-reprint-design.md`

## Constraints

- Existing pre-dispatch menu continues to show only Confirm and Handling.
- Historical mode excludes Cancelled and statuses before Confirm.
- Historical search is bounded to 60 TMS pages per warehouse and discloses an incomplete scan.
- Search and detail reads must not write to TMS or application storage.
- Reprint uses current live TMS values, not a saved snapshot from the time of confirmation.

## Review Focus

- A Trip in Completed status remains searchable and printable.
- Cancelled and Draft trips remain excluded.
- Missing shipment details cannot produce a misleading empty print.
- Broad date range reaching the scan cap is clearly disclosed.
- Existing pre-dispatch page and print modes remain unchanged.

---

### Task 1: Read-only historical search and selected-trip detail loader

**Files:** `web/src/api/tmsPull.ts`

- [x] Add a summary scan with date, warehouse, max page, completion, and count fields.
- [x] Filter Confirm through Completed, excluding Cancelled and earlier statuses.
- [x] Add a detail loader that retrieves shipment rows for selected Trip IDs only.

### Task 2: Historical reprint page and navigation

**Files:** `web/src/pages/CloudDeliveryDocumentsArchive.tsx`, `web/src/AppCloud.tsx`, `web/src/components/CloudLayout.tsx`

- [x] Add the separate menu and permission-protected route.
- [x] Add date range, warehouse, and Trip number search.
- [x] Load details after selecting a Trip and reuse whole-Trip/all-Ship-To/single-Ship-To print actions.
- [x] Explain current-data semantics and scan-cap/missing-detail states.

### Task 3: Documentation and verification

**Files:** `README.md`

- [x] Document the historical reprint flow.
- [x] Run cloud build/typecheck and inspect the final diff.

