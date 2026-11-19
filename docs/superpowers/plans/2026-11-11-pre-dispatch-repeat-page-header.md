# Repeat Delivery Header on Every Printed Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repeat the complete Trip/Ship To header and column labels on continuation pages while retaining every row within A4 and signatures within the page edge.

**Architecture:** Pin the Trip and Ship To/Location header 8mm from the page top. A blank 62mm row in the repeating `thead` reserves space before the column labels; a blank 42mm row in the repeating `tfoot` reserves the signature area. Keep Ship To groups in separate `tbody` sections and render the total only once after the final item.

**Tech Stack:** TypeScript, Vitest, existing HTML print builder, Chromium print layout.

**Spec:** `docs/superpowers/specs/2026-11-11-pre-dispatch-repeat-page-header-design.md`

## Global Constraints

- Keep A4, the fixed 6-column proportions, and long-value wrapping.
- Repeat Trip metadata, Ship To/Location, and column labels on continuation pages.
- Preserve every source Ship To and item row exactly once.
- Keep signatures at the bottom, safely inside the paper boundary.
- Do not alter TMS data, Orders/POD, or Trip states.

## Review Focus

- Many rows spanning multiple pages — header repeats and every row remains once.
- Long text and Shipment IDs — wrap within the existing fixed column widths.
- Ship To group at a page boundary — group heading and its item rows remain present.
- Footer totals — appear once after the last item, not once per page.
- Live source mismatch — report that the supplied PDF and current TMS Trip/warehouse counts differ.

---

### Task 1: Repeating header and stable pagination

**Files:**
- Modify: `web/src/utils/preDispatchDocument.ts`
- Test: `web/src/utils/preDispatchDocument.test.ts`
- Update: `README.md`

- [x] Add assertions for the page header, safe signature inset, six Ship To groups, and every item row exactly once.
- [x] Reserve top and bottom space with repeating table header/footer rows, so print margin overrides cannot hide the header or overlap signatures.
- [x] Keep the item total in one non-repeating body row; keep Ship To label attached to its first item row.
- [x] Run focused tests and cloud build.
- [ ] Render and inspect a multi-page preview. Chrome headless is blocked by the Windows runtime's Crashpad/IPC permissions, and local file navigation is blocked by browser security policy.
- [x] Update the README and record the source PDF/TMS data mismatch.

