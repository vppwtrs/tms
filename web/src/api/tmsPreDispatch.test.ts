import { beforeEach, describe, expect, it, vi } from 'vitest'

const tmsOp = vi.fn()
vi.mock('./tmsAuth.js', () => ({ tmsOp: (...args: unknown[]) => tmsOp(...args) }))
vi.mock('./supabase.js', () => ({ supabase: {}, toDataError: (error: unknown) => error }))

import { scanTripsForPreDispatch } from './tmsPull'

describe('scanTripsForPreDispatch', () => {
  beforeEach(() => tmsOp.mockReset())

  it('keeps only Confirm and Handling trips in range and normalizes live header and PL fields', async () => {
    tmsOp
      .mockResolvedValueOnce({ items: [
        { id: 'confirm', tripNo: 'T-1', orderDate: '2026-10-26', statusId: 2, warehouseCode: 'KM23-CW-01', driverName: 'Somchai', license_plate: 'กข-123', vehicleTypeName: '4W', areaName: 'Bangkok' },
        { id: 'handling', tripNo: 'T-2', orderDate: '2026-10-25', statusId: 3, pickingLists: [{ pickingListNo: 'PL-2', shipToName: 'Other shop' }] },
        { id: 'on-road', tripNo: 'T-3', orderDate: '2026-10-26', statusId: 4 },
        { id: 'cancelled', tripNo: 'T-4', orderDate: '2026-10-26', statusId: 6 },
        { id: 'outside-range', tripNo: 'T-5', orderDate: '2026-10-27', statusId: 2 },
        { id: 'no-lists', tripNo: 'T-6', orderDate: '2026-10-26', statusId: 2 },
      ] })
      .mockResolvedValueOnce({ lists: [{ id: 'confirm', items: [{ pickingListNo: 'PL-1', shipToName: 'Shop', shipToAddress: 'Address', details: [{ itemNo: 'SKU-1', description: 'Box', qty: 2 }] }] }] })

    const trips = await scanTripsForPreDispatch({
      from: '2026-10-25', to: '2026-10-26', warehouse: { code: 'KM23-CW-01', id: 'warehouse-guid', description: null },
    })

    expect(trips.map((trip) => trip.tripNo)).toEqual(['T-1', 'T-2'])
    expect(trips[0]).toMatchObject({ driver: 'Somchai', licensePlate: 'กข-123', vehicleTypeName: '4W', area: 'Bangkok' })
    expect(trips[0]?.rows[0]).toMatchObject({ pickingListNo: 'PL-1', shipToName: 'Shop', shipToAddress: 'Address', itemNo: 'SKU-1', itemQty: 2 })
    expect(tmsOp).toHaveBeenNthCalledWith(2, 'scanTripPickingLists', { ids: ['confirm', 'handling', 'no-lists'] })
  })

  it('returns an empty result when all TMS statuses are beyond pre-dispatch', async () => {
    tmsOp.mockResolvedValueOnce({ items: [{ id: 'done', tripNo: 'T-DONE', orderDate: '2026-10-26', statusId: 5 }] })
    await expect(scanTripsForPreDispatch({
      from: '2026-10-26', to: '2026-10-26', warehouse: { code: 'KM23-CW-01', id: 'guid', description: null },
    })).resolves.toEqual([])
    expect(tmsOp).toHaveBeenCalledTimes(1)
  })
})
