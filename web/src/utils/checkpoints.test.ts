import { beforeEach, describe, expect, it, vi } from 'vitest'

const insert = vi.fn()
vi.mock('../api/supabase.js', () => ({
  supabase: { from: () => ({ insert }) },
}))

import { QUEUE_KEY, flushCheckpointQueue, logCheckpoint } from './checkpoints'

function mockGeo(ok: boolean) {
  const getCurrentPosition = vi.fn((s: PositionCallback, e: PositionErrorCallback) =>
    ok
      ? s({ coords: { latitude: 13.7, longitude: 100.5, accuracy: 12.4 } } as GeolocationPosition)
      : e({ code: 1 } as GeolocationPositionError),
  )
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
  return getCurrentPosition
}
const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true })

describe('logCheckpoint', () => {
  beforeEach(() => {
    localStorage.clear()
    insert.mockReset()
    setOnline(true)
  })

  it('inserts row with coords once', async () => {
    const geo = mockGeo(true)
    insert.mockResolvedValue({ error: null })
    await logCheckpoint('t1', 'fuel', { liters: 20 })
    expect(geo).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0]![0][0]
    expect(row).toMatchObject({ trip_id: 't1', kind: 'fuel', lat: 13.7, lng: 100.5, accuracy_m: 12, extra: { liters: 20 } })
  })

  it('logs without coords when geolocation denied', async () => {
    mockGeo(false)
    insert.mockResolvedValue({ error: null })
    await logCheckpoint('t1', 'arrive')
    expect(insert.mock.calls[0]![0][0]).toMatchObject({ lat: null, lng: null })
  })

  it('queues when offline, flushes when back online', async () => {
    mockGeo(true)
    setOnline(false)
    await logCheckpoint('t1', 'break_start')
    expect(insert).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
    setOnline(true)
    insert.mockResolvedValue({ error: null })
    expect(await flushCheckpointQueue()).toBe(1)
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull()
  })

  it('queues when insert fails', async () => {
    mockGeo(true)
    insert.mockResolvedValue({ error: { message: 'x' } })
    await logCheckpoint('t1', 'trip_end')
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1)
  })
})
