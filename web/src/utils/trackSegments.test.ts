import { describe, expect, it } from 'vitest'
import { trackSegments } from './trackSegments'

const t = (m: number): string => new Date(Date.UTC(2026, 9, 16, 3, m)).toISOString()

describe('trackSegments', () => {
  it('ยุบจุดที่จอดนิ่งเป็นช่วงเดียว', () => {
    const track = Array.from({ length: 20 }, (_, i) => ({ lat: 13.64074 + (i % 2) * 0.00002, lng: 100.74269, recorded_at: t(i) }))
    const s = trackSegments(track)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ kind: 'stop', minutes: 19, points: 20 })
  })

  it('จอด → วิ่ง → จอด ได้สามช่วง ระยะทางรวมอยู่ในช่วงเดินทาง', () => {
    const track = [
      ...Array.from({ length: 10 }, (_, i) => ({ lat: 13.6, lng: 100.7, recorded_at: t(i) })),
      ...Array.from({ length: 5 }, (_, i) => ({ lat: 13.6 + (i + 1) * 0.01, lng: 100.7, recorded_at: t(10 + i) })),
      ...Array.from({ length: 10 }, (_, i) => ({ lat: 13.65, lng: 100.7, recorded_at: t(15 + i) })),
    ]
    const s = trackSegments(track)
    expect(s.map((x) => x.kind)).toEqual(['stop', 'move', 'stop'])
    expect(s[1]!.km).toBeGreaterThan(5)
    expect(s[1]!.km).toBeLessThan(6)
  })

  it('ไม่มีจุด ไม่มีช่วง', () => {
    expect(trackSegments([])).toEqual([])
  })
})
