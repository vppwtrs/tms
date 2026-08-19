import { Link } from 'react-router-dom'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Badge, PageHeader } from '../components/ui'
import { IconBox, IconRoute, IconTable, IconTruckBig } from '../components/icons'

/** หน้าแรกแบบศูนย์ควบคุม — แสดงเฉพาะงานที่ผู้ใช้ต้องทำจริง */
export default function CloudHome(): React.JSX.Element {
  const { can, user } = useCloudAuth()
  const actions = [
    can('dispatch.view') && { to: '/tms-trips', icon: IconTable, title: 'งานจาก TMS', desc: 'ข้อมูลไหลเข้าเองทุก 5 นาที — ตรวจเที่ยวแล้วสั่งงานได้ที่หน้าเดียว', label: 'เปิดงานจาก TMS', tone: 'accent' },
    can('dispatch.view') && { to: '/dispatch', icon: IconRoute, title: 'จัดแผนงาน', desc: 'ตรวจเที่ยว รถ คนขับ และลำดับงานก่อนปล่อยงาน', label: 'เปิดแผนงาน', tone: 'neutral' },
    can('orders.view') && { to: '/orders', icon: IconBox, title: 'ติดตามออเดอร์', desc: 'ดูว่างานอยู่ขั้นตอนไหนและมีอะไรต้องจัดการ', label: 'ดูออเดอร์', tone: 'neutral' },
    can('myjobs.view') && { to: '/my-jobs', icon: IconTruckBig, title: 'งานของฉัน', desc: 'เปิดเที่ยวที่ได้รับมอบหมายและเริ่มส่งงาน', label: 'เปิดงานของฉัน', tone: 'accent' },
  ].filter(Boolean) as Array<{ to: string; icon: React.ComponentType<{ size?: number }>; title: string; desc: string; label: string; tone: 'accent' | 'neutral' }>

  return (
    <>
      <PageHeader title={`สวัสดี${user?.name ? ` คุณ${user.name}` : ''}`} subtitle="ศูนย์ควบคุมงานขนส่ง — เลือกงานที่ต้องทำจากด้านล่าง" />
      <section className="ops-home-grid" aria-label="งานหลัก">
        {actions.map((action) => {
          const Icon = action.icon
          return <Link key={action.to} to={action.to} className={`ops-action-card ops-action-${action.tone}`}>
            <div className="ops-action-icon"><Icon size={22} /></div>
            <div className="ops-action-body"><h2>{action.title}</h2><p>{action.desc}</p></div>
            <Badge label={action.label} tone={action.tone === 'accent' ? 'accent' : 'neutral'} />
          </Link>
        })}
      </section>
      <div className="ops-home-note"><strong>ลำดับการทำงานแนะนำ</strong><span>งานจาก TMS → ตรวจแผนงาน → ปล่อยงานให้คนขับ</span></div>
    </>
  )
}
