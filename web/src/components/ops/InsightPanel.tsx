import { Link } from 'react-router-dom'
import type { InsightItem } from '../../api/opsInsights'
import { IconCheck, IconSparkle } from '../icons'
import { Skeleton } from '../ui'

/**
 * แผงสรุปประจำวัน — กรอบเป็นของใหม่ แถวข้างในใช้ .ai-item ของเดิมทั้งชุด
 *
 * ตั้งชื่อบนหน้าจอว่า "สรุปประจำวัน" ไม่ใช่ "AI" ตามที่มันเป็นจริง ๆ:
 * เป็นกฎที่เขียนไว้ใน api/opsInsights.ts อ่านตามได้ทีละบรรทัด และเถียงได้เวลามันผิด
 */

export function InsightPanel({
  headline, items, loading,
}: {
  headline: string
  items: InsightItem[]
  loading: boolean
}): React.JSX.Element {
  return (
    <section className="ops-panel ops-insights" aria-label="สรุปประจำวัน">
      <div className="ops-panel-head">
        {/* ชื่อบนจอบอกสิ่งที่ต้องทำ ไม่ใช่ชื่อของกลไก — และไม่เรียกว่า AI
            ตามที่มันเป็นจริง ๆ: เป็นกฎที่เขียนไว้ใน api/opsInsights.ts
            ที่มายังบอกไว้ที่ title ให้คนที่สงสัยชี้เมาส์ดูได้ */}
        <h2 className="ops-panel-title" title="คำนวณจากข้อมูลจริงด้วยกฎที่เขียนไว้ตรง ๆ ไม่ใช้บริการภายนอก">
          <IconSparkle size={16} /> ต้องจัดการตอนนี้
        </h2>
        {items.length > 0 && <span className="ops-panel-count is-alert">{items.length} เรื่อง</span>}
      </div>
      <div className="ops-panel-body">
        {loading ? (
          <Skeleton height={96} />
        ) : (
          <>
            <div className="ai-headline">{headline}</div>
            {items.length === 0 ? (
              <div className="ops-insight-empty">
                <IconCheck size={17} /> ไม่มีเรื่องค้างที่ต้องตามในตอนนี้
              </div>
            ) : (
              <div className="ai-list">
                {items.map((item) => (
                  <div key={item.title} className={`ai-item ai-${item.tone}`}>
                    <div className="ai-item-main">
                      <b>{item.title}</b>
                      <span className="ai-detail">{item.detail}</span>
                    </div>
                    {item.action && (
                      <Link to={item.action.to} className="ai-action">
                        {item.action.label} →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
