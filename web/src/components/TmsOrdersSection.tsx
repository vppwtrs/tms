import { useEffect, useRef, useState } from 'react'
import { useTmsPull } from '../hooks/useTmsPull'
import { refreshOrderItemQty } from '../api/tms'
import { useToast } from '../context/ToastContext'
import { Button, Drawer, Field, Input, Modal } from './ui'
import { IconRefresh } from './icons'
import { TmsTripsPanel } from './TmsTripsPanel'
import { fmtDate, fmtDateTime } from '../utils/format'

/**
 * งานจาก TMS บนหน้าออเดอร์ — แถบสถานะรอบดึง + ลิ้นชักเที่ยวรอนำเข้า
 *
 * useTmsPull ถูกสร้างที่นี่ **ที่เดียว** และคอมโพเนนต์นี้ถูก mount เฉพาะคนที่มี tms.view
 * รอบดึงทุก 5 นาทีจึงเดินต่อเนื่องแม้ลิ้นชักปิดอยู่ ตัวลิ้นชักรับ engine ตัวเดิมผ่าน props
 * ไม่เรียก hook ซ้ำ ไม่งั้นจะมีสองรอบยิง TMS พร้อมกัน
 */
export function TmsOrdersSection({ open, onOpenChange, onPending, onChanged }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** จำนวนเที่ยวรอนำเข้า (null = ยังไม่รู้) ให้ปุ่มบนหัวหน้าแสดงเป็นป้าย */
  onPending: (n: number | null) => void
  /** รอบดึงจบหรือมีการนำเข้าเที่ยว — หน้าออเดอร์ต้องโหลดรายการใหม่ */
  onChanged: () => void
}): React.JSX.Element {
  const { push } = useToast()
  const pull = useTmsPull()
  const [pullOpen, setPullOpen] = useState(false)

  const changedRef = useRef(onChanged)
  changedRef.current = onChanged
  const pendingRef = useRef(onPending)
  pendingRef.current = onPending

  const pending = pull.board ? pull.board.trips_pending_import : null
  useEffect(() => { pendingRef.current(pending) }, [pending])
  useEffect(() => () => pendingRef.current(null), [])

  /* รอบดึงจบแล้วรายการออเดอร์ต้องตามทันที */
  useEffect(() => {
    if (!pull.busy && pull.lastRun) changedRef.current()
  }, [pull.lastRun])

  /* ปุ่มที่กดแล้วเห็นผลทันที — ของเดิมซ่อมให้เงียบ ๆ ท้ายรอบดึง แล้วถ้าไม่ได้ผล
     ก็ไม่มีใครรู้ว่ามันทำงานหรือเปล่า ปุ่มนี้ตอบให้ชัดว่าแก้ไปกี่รายการ */
  const fixQty = async (): Promise<void> => {
    try {
      const r = await refreshOrderItemQty()
      push(r.fixed + r.added > 0 ? 'success' : 'warning',
        r.fixed + r.added > 0
          ? `ซ่อมจำนวนสินค้า ${r.fixed} รายการ · เติมรายการที่หาย ${r.added}`
          : 'ไม่มีรายการที่ต้องซ่อม — จำนวนในออเดอร์ตรงกับใบดิบจาก TMS แล้ว')
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ซ่อมจำนวนไม่สำเร็จ')
    }
  }

  const warn = pull.error !== null

  return (
    <>
      {/* แถบเล็ก ไม่ใช่หน้าเต็ม — ข้อมูลไหลเข้าเองอยู่แล้วทุก 5 นาที ปุ่มมีไว้เร่งรอบ
          และบอกว่าตอนนี้ระบบยังต่อกับ TMS อยู่จริง
          การเข้าระบบ TMS ใหม่ทำที่หน้าล็อกอินของระบบ (token หมดอายุแล้วระบบพาออกเอง)
          จึงไม่มีปุ่มล็อกอินแยกตรงนี้ */}
      <div className={`tms-pullbar${warn ? ' is-warn' : ''}`} role={warn ? 'alert' : undefined}>
        <span className={`tms-pulldot${pull.busy ? ' is-busy' : ''}${warn ? ' is-warn' : ''}`} aria-hidden="true" />
        <button type="button" className="link-button tms-pulltext" onClick={() => setPullOpen(true)} title="ดูรายละเอียดการดึงข้อมูล">
          {pull.error
            ? pull.error
            : pull.busy
              ? 'กำลังดึงข้อมูลจาก TMS…'
              : pull.lastRun
                ? `ดึงจาก TMS ล่าสุด ${pull.lastRun}`
                : 'กำลังเริ่มรอบดึงข้อมูล…'}
        </button>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />}
                onClick={() => void pull.cycle('poll')} disabled={pull.busy}>
          รีเฟรช
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPullOpen(true)}>
          รายละเอียด
        </Button>
      </div>

      <Drawer open={open} onClose={() => onOpenChange(false)} title="งานจาก TMS">
        <TmsTripsPanel pull={pull} onChanged={onChanged} />
      </Drawer>

      {/* จอ "กำลังโหลด" ขึ้นเฉพาะรอบที่คนกดดึงย้อนหลังเอง ซึ่งกินเวลาเป็นนาที
          รอบเฝ้าสถานะทุก 5 นาทีต้องไม่เด้งจอทับ ไม่งั้นคนจะปิดหน้านี้ทิ้ง แล้วข้อมูลก็หยุดไหล */}
      <Modal open={pull.blocking} onClose={() => { /* ปิดเองไม่ได้ระหว่างดึง — ปิดแล้วรอบยังวิ่งอยู่ดี */ }} title="กำลังดึงข้อมูลจาก TMS">
        <div style={{ display: 'grid', gap: 10, padding: '6px 0' }}>
          <div className="tms-pullbars" aria-hidden="true"><span /><span /><span /></div>
          <div style={{ fontSize: 13 }}>{pull.log || 'กำลังติดต่อ TMS…'}</div>
          <div className="text-xs text-muted">
            ดึงครบทุกคลังที่บัญชีนี้มีสิทธิ์ ({pull.warehouses.length} คลัง) — ช่วงวันที่ยาวใช้เวลาหลายนาที
          </div>
        </div>
      </Modal>

      <Modal open={pullOpen} onClose={() => setPullOpen(false)} title="การดึงข้อมูลจาก TMS">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="text-xs text-muted">
            ระบบดึงเที่ยวของวันนี้ให้เองทุก 5 นาทีตราบที่เปิดหน้าออเดอร์ค้างไว้ ({pull.warehouses.length} คลัง)
          </div>

          <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={pull.auto} onChange={(e) => pull.setAuto(e.target.checked)} />
            เฝ้าสถานะให้อัตโนมัติทุก 5 นาที
          </label>

          {pull.board && (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div>
                <div className="text-xs text-muted">วันที่ล่าสุดที่มีงาน</div>
                <div style={{ fontSize: 20, fontWeight: 660 }}>{fmtDate(pull.board.latest_date)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">เที่ยวของกองรถเรา</div>
                <div style={{ fontSize: 20, fontWeight: 660 }} className="num">{pull.board.trips}</div>
              </div>
              <div>
                <div className="text-xs text-muted">เที่ยวรอนำเข้า</div>
                <div style={{ fontSize: 20, fontWeight: 660 }} className="num">{pull.board.trips_pending_import}</div>
              </div>
              <div>
                <div className="text-xs text-muted">จำนวนคัน</div>
                <div style={{ fontSize: 20, fontWeight: 660 }} className="num">{pull.board.total_qty}</div>
              </div>
            </div>
          )}

          {/* ชื่อ carrier ที่ระบบไม่รู้จักทำให้เที่ยวถูกทิ้งเงียบ ๆ ทั้งชุด
              ซึ่งหน้าตาเหมือน "ไม่มีงาน" เป๊ะ เคยกินเวลาไล่หาสาเหตุมาแล้ว */}
          {pull.tripPush && pull.tripPush.seen > 0 && pull.tripPush.skipped_carrier === pull.tripPush.seen && (
            <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
              ดึงมาได้ {pull.tripPush.seen} เที่ยว แต่ถูกกรองทิ้งทั้งหมดเพราะระบบไม่รู้จักชื่อผู้ให้บริการขนส่ง
              — ต้องเพิ่มชื่อ carrier ลงตาราง tms_carriers ก่อน
            </div>
          )}

          {pull.board && (
            <div className="text-xs text-muted">
              ดึงล่าสุด {fmtDateTime(pull.board.synced_at)} · สถานะเปลี่ยนล่าสุด {fmtDateTime(pull.board.last_change_at)}
            </div>
          )}

          {/* บัญชี TMS แต่ละคนเห็นคลังไม่เท่ากัน — ต้องเห็นว่าวันนี้ทั้งบริษัทดึงคลังไหนไปแล้ว
              ไม่ใช่เห็นแค่ผลของตัวเองแล้วเข้าใจว่าครบ */}
          {pull.coverage && pull.coverage.runs > 0 && (
            <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>รอบดึงใน 24 ชั่วโมง</div>
              <div style={{ fontSize: 12.5 }}>
                คลังที่ถูกดึงแล้ว: <b>{pull.coverage.warehouses.length ? pull.coverage.warehouses.join(', ') : 'ไม่มี'}</b>
              </div>
              {(() => {
                const missing = pull.warehouses.map((w) => w.code).filter((c) => !pull.coverage?.warehouses.includes(c))
                return missing.length > 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
                    ยังไม่มีใครดึงคลัง: <b>{missing.join(', ')}</b>
                  </div>
                ) : null
              })()}
              {pull.coverage.last_run && !pull.coverage.last_run.ok && (
                <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
                  รอบล่าสุด ({pull.coverage.last_run.by ?? 'ไม่ทราบชื่อ'}) ล้มเหลว: {pull.coverage.last_run.error}
                </div>
              )}
            </div>
          )}

          {/* ตัวเลขนี้มีไว้ตัดสินใจเรื่องเดียว: ย้ายรอบซิงก์ไปฝั่งเซิร์ฟเวอร์แบบเก็บ token
              แทนรหัสผ่าน คุ้มหรือไม่ */}
          {pull.tokenLeft !== null && (
            <div className="text-xs text-muted">
              token ของ TMS หมดอายุในอีก{' '}
              <b>
                {pull.tokenLeft <= 0
                  ? 'หมดอายุแล้ว'
                  : pull.tokenLeft < 3600
                    ? `${Math.floor(pull.tokenLeft / 60)} นาที`
                    : pull.tokenLeft < 86400
                      ? `${Math.floor(pull.tokenLeft / 3600)} ชั่วโมง`
                      : `${Math.floor(pull.tokenLeft / 86400)} วัน`}
              </b>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>ซ่อมจำนวนสินค้าในออเดอร์</div>
            <div className="text-xs text-muted">
              จำนวนในออเดอร์ถูกคำนวณตอนนำเข้า ไม่ได้อ่านสดจากใบดิบ ใบที่นำเข้าไปตอนที่ TMS
              ยังส่งจำนวนมาไม่ครบจึงค้างเป็น 0 ปุ่มนี้คำนวณใหม่จากใบดิบที่มีอยู่ ไม่ต้องดึงจาก TMS ใหม่
            </div>
            <Button variant="outline" onClick={() => void fixQty()}>ซ่อมจำนวนสินค้า</Button>
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>ดึงย้อนหลังเอง</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="ตั้งแต่วันที่" required>
                <Input type="date" value={pull.from} onChange={(e) => pull.setFrom(e.target.value)} disabled={pull.busy} />
              </Field>
              <Field label="ถึงวันที่" required>
                <Input type="date" value={pull.to} onChange={(e) => pull.setTo(e.target.value)} disabled={pull.busy} />
              </Field>
            </div>
            <Button onClick={() => void pull.cycle('range')} loading={pull.busy} disabled={!pull.warehouses.length}>
              ดึง Trip ช่วง {fmtDate(pull.from)} – {fmtDate(pull.to)}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
