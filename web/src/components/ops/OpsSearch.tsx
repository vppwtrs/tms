import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCloudAuth } from '../../context/CloudAuthContext'
import { listOrders } from '../../api/orders'
import { listVehicles } from '../../api/vehicles'
import { IconBox, IconSearch, IconTruckBig } from '../icons'

/**
 * ช่องค้นหารวมบนแถบบน
 *
 * ปัญหาเดิม: เลข PL ที่คนขับโทรมาบอก ต้องเดาก่อนว่ามันอยู่หน้าไหน แล้วค่อยเข้าไปค้น
 * ในช่องค้นหาของหน้านั้น — สองขั้นตอนสำหรับคำถามเดียวที่ถูกถามทั้งวัน
 *
 * ตรงนี้ไม่ได้สร้าง endpoint ใหม่ ยิงฟังก์ชันรายการเดิมที่รองรับ q อยู่แล้ว
 * แล้วขอมาแค่ไม่กี่แถว ผลที่กดจะพาไปหน้านั้นพร้อมคำค้นติดไปใน URL
 * หน้าปลายทางอ่าน ?q= ไปตั้งเป็นค่าตั้งต้นของช่องค้นหาตัวเอง ผลที่เห็นจึงตรงกัน
 */

interface Hit {
  key: string
  icon: React.ComponentType<{ size?: number }>
  title: string
  kind: string
  to: string
}

export function OpsSearch(): React.JSX.Element | null {
  const { can } = useCloudAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const popId = useId()

  const canOrders = can('orders.view')
  const canVehicles = can('vehicles.view')

  useEffect(() => {
    const term = q.trim()
    /* ตัวเดียวยังไม่พอจะเป็นคำค้น — ยิงไปก็ได้ทั้งฐานกลับมา */
    if (term.length < 2) {
      setHits(null)
      return
    }
    let dead = false
    setBusy(true)
    /* หน่วงไว้ให้พิมพ์จบก่อน ไม่งั้นได้หนึ่งคำขอต่อหนึ่งตัวอักษร */
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [orders, vehicles] = await Promise.all([
            canOrders ? listOrders({ q: term, limit: 5 }).catch(() => null) : Promise.resolve(null),
            canVehicles ? listVehicles({ q: term, limit: 4 }).catch(() => null) : Promise.resolve(null),
          ])
          if (dead) return
          const found: Hit[] = []
          for (const o of orders?.rows ?? []) {
            found.push({
              key: `o${o.id}`,
              icon: IconBox,
              title: `${o.tms_picking_list_no ?? o.order_no} · ${o.destination ?? '—'}`,
              kind: 'ออเดอร์',
              to: `/orders?q=${encodeURIComponent(o.tms_picking_list_no ?? o.order_no)}`,
            })
          }
          for (const v of vehicles?.rows ?? []) {
            found.push({
              key: `v${v.id}`,
              icon: IconTruckBig,
              title: v.plate_no,
              kind: 'รถ',
              to: `/vehicles?q=${encodeURIComponent(v.plate_no)}`,
            })
          }
          setHits(found)
        } finally {
          if (!dead) setBusy(false)
        }
      })()
    }, 300)
    return () => {
      dead = true
      window.clearTimeout(timer)
    }
  }, [q, canOrders, canVehicles])

  /* กดที่อื่นแล้วผลต้องหุบ ไม่ใช่ค้างทับหน้าจอจนกว่าจะลบคำค้น */
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setHits(null)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  /* ไม่มีสิทธิ์ดูทั้งออเดอร์และรถ ก็ไม่มีอะไรให้ค้น */
  if (!canOrders && !canVehicles) return null

  const go = (to: string): void => {
    setHits(null)
    setQ('')
    navigate(to)
  }

  return (
    <div className="ops-search" ref={boxRef}>
      <span className="ops-search-ic" aria-hidden>
        <IconSearch size={16} />
      </span>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setHits(null)
          if (e.key === 'Enter' && hits?.[0]) go(hits[0].to)
        }}
        placeholder="ค้นเลข PL ร้าน หรือทะเบียนรถ"
        aria-label="ค้นหาทั้งระบบ"
        aria-controls={popId}
        aria-expanded={hits !== null}
      />
      {hits !== null && (
        <div className="ops-search-pop" id={popId} role="listbox">
          {hits.length === 0 ? (
            <div className="ops-search-empty">{busy ? 'กำลังค้น…' : 'ไม่พบ'}</div>
          ) : (
            hits.map((h) => (
              <button key={h.key} type="button" className="ops-search-item" role="option" aria-selected={false} onClick={() => go(h.to)}>
                <h.icon size={15} />
                <span>{h.title}</span>
                <span className="ops-search-kind">{h.kind}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
