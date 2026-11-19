import '../../styles/driver-pod.css'

/** จอ 17 — ยังปิดงานไม่ได้ เพราะหลักฐานไม่ครบ; missing = ข้อความต่อร้าน เช่น "ร้านพัฒนายนต์ · ไม่มีรูปถ่าย" */
export function PodBlocked({ missing, onFix }: { missing: string[]; onFix: () => void }): React.JSX.Element {
  return (
    <section className="pod-scope pb" role="alert" aria-labelledby="pb-title">
      <h2 id="pb-title">ยังปิดงานไม่ได้</h2>
      <p className="pb-sub">มี {missing.length} ร้านที่หลักฐานยังไม่ครบ เติมให้ครบก่อนแล้วกดปิดงานอีกครั้ง</p>
      <ul className="pb-list">
        {missing.map((m) => (
          <li key={m}><button type="button" className="pb-row" onClick={onFix}><span>{m}</span><b>เติม ›</b></button></li>
        ))}
      </ul>
      <button type="button" className="pb-fix" onClick={onFix}>เติมหลักฐาน</button>
    </section>
  )
}
