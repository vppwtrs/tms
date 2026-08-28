import { Link } from 'react-router-dom'
import type { InsightItem } from '../../api/opsInsights'
import { IconCheck, IconSparkle } from '../icons'
import { Skeleton } from '../ui'

/**
 * ใบสั่งงานประจำวัน (Daily Job)
 *
 * เนื้อเหมือนเดิมทุกบรรทัด เปลี่ยน**วิธีอ้างถึง**: เดิมเป็นข้อความลอย ๆ ที่พูดถึง
 * ในที่ประชุมไม่ได้ ต้องอ่านทั้งประโยคซ้ำทุกครั้ง ตอนนี้ทุกเรื่องมีเลขใบ
 * ระดับความเร่งด่วน และหน่วยงานเจ้าของ — ถามได้ว่า "JOB-280869-01 ปิดหรือยัง"
 *
 * ตั้งชื่อบนหน้าจอตามที่มันเป็นจริง ๆ ไม่ใช่ "AI": เป็นกฎที่เขียนไว้ใน
 * api/opsInsights.ts อ่านตามได้ทีละบรรทัด และเถียงได้เวลามันผิด
 */

/** ระดับความเร่งด่วน — มาจาก tone ของกฎ ไม่ได้ตั้งใหม่ ป้าย P1/P2/P3 เป็นคำที่
 *  ทีมใช้อยู่แล้วในรายงานประจำสัปดาห์ จึงไม่ต้องสอนใครใหม่ */
const SEVERITY: Record<string, string> = { danger: 'P1', warn: 'P2', info: 'P3' }

/** เจ้าของเรื่อง — เดาจากปลายทางของปุ่ม เพราะปุ่มชี้ไปหน้าที่หน่วยงานนั้นทำงานอยู่
 *  เรื่องที่ไม่มีปุ่มก็ไม่มีเจ้าของชัด ปล่อยว่างดีกว่าเดาแล้วโยนงานผิดฝ่าย */
const OWNER: Record<string, string> = {
  '/tracking': 'ศูนย์ควบคุมการเดินรถ',
  '/dispatch': 'ฝ่ายวางแผนการขนส่ง',
  '/drivers': 'ฝ่ายบุคคลขนส่ง',
  '/orders': 'ธุรการขนส่ง',
  '/tms-trips': 'ธุรการขนส่ง',
}

/** เลขใบ JOB-DDMMYY-NN — เรียงตามลำดับที่แสดงบนจอ ไม่ใช่เลขจากฐาน
 *  ใบเกิดใหม่ทุกรอบที่คำนวณ จึงไม่ใช่รหัสถาวร และไม่ควรถูกใช้อ้างอิงข้ามวัน */
function jobId(index: number, now: Date): string {
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yy = String((now.getFullYear() + 543) % 100).padStart(2, '0')
  return `JOB-${dd}${mm}${yy}-${String(index + 1).padStart(2, '0')}`
}

export function InsightPanel({
  headline, items, loading,
}: {
  headline: string
  items: InsightItem[]
  loading: boolean
}): React.JSX.Element {
  return (
    <section className="ops-panel ops-insights" aria-label="ใบสั่งงานประจำวัน">
      <div className="ops-panel-head">
        {/* ชื่อบนจอบอกสิ่งที่ต้องทำ ไม่ใช่ชื่อของกลไก — และไม่เรียกว่า AI
            ตามที่มันเป็นจริง ๆ: เป็นกฎที่เขียนไว้ใน api/opsInsights.ts
            ที่มายังบอกไว้ที่ title ให้คนที่สงสัยชี้เมาส์ดูได้ */}
        <h2 className="ops-panel-title" title="คำนวณจากข้อมูลจริงด้วยกฎที่เขียนไว้ตรง ๆ ไม่ใช้บริการภายนอก">
          <IconSparkle size={16} /> ใบสั่งงานประจำวัน
        </h2>
        {items.length > 0 && <span className="ops-panel-count is-alert">{items.length} ใบ</span>}
      </div>
      <div className="ops-panel-body">
        {loading ? (
          <Skeleton height={96} />
        ) : (
          <>
            <div className="ai-headline">{headline}</div>
            {items.length === 0 ? (
              <div className="ops-insight-empty">
                <IconCheck size={17} /> วันนี้ไม่มีใบสั่งงานค้าง
              </div>
            ) : (
              <div className="ai-list">
                {items.map((item, i) => {
                  const owner = item.action ? OWNER[item.action.to] : undefined
                  return (
                    <div key={item.title} className={`ai-item ai-${item.tone}`}>
                      <div className="ai-item-main">
                        <span className="ops-job-id">{jobId(i, new Date())}</span>
                        <b>{item.title}</b>
                        <span className="ai-detail">{item.detail}</span>
                        {owner && <span className="ops-job-owner">ผู้รับผิดชอบ: {owner}</span>}
                      </div>
                      <div className="ops-job-side">
                        <span className={`ops-sev is-${item.tone}`}>{SEVERITY[item.tone] ?? 'P3'}</span>
                        {item.action && (
                          <Link to={item.action.to} className="ai-action">
                            {item.action.label} →
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
