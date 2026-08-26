import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import type { CustomerDetail as CustomerDetailType, CustomerTask, Interaction, Order, Quote } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, EmptyState, ErrorBox, Field, HelpTip, Input, Modal, Select, Skeleton, Textarea } from '../components/ui'
import { IconCheck, IconChevronLeft, IconPlus, IconTrash } from '../components/icons'
import { INTERACTION_TYPE_ICON, INTERACTION_TYPE_LABEL, ORDER_STATUS_LABEL, ORDER_TONE, QUOTE_STATUS_LABEL, QUOTE_TONE, SEGMENT_LABEL, SEGMENT_TONE } from '../utils/constants'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from '../utils/format'

type Tab = 'info' | 'orders' | 'quotes' | 'interactions' | 'tasks'

export default function CustomerDetail(): React.JSX.Element {
  const { id } = useParams()
  const customerId = Number(id)
  const { push } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const canEdit = user?.role !== 'viewer'

  const [tab, setTab] = useState<Tab>('info')

  const { data: detail, loading, error, refetch } = useApi<CustomerDetailType>(() => api.get(`/customers/${customerId}/detail`), [customerId])
  const { data: orders } = useApi<Order[]>(() => api.get(`/orders?customer_id=${customerId}&limit=50`), [customerId])
  const { data: quotes, refetch: refetchQuotes } = useApi<Quote[]>(() => api.get(`/quotes/by-customer/${customerId}`), [customerId])
  const { data: interactions, refetch: refetchInteractions } = useApi<Interaction[]>(() => api.get(`/customers/${customerId}/interactions`), [customerId])
  const { data: tasks, refetch: refetchTasks } = useApi<CustomerTask[]>(() => api.get(`/customers/${customerId}/tasks`), [customerId])

  const [interactionOpen, setInteractionOpen] = useState(false)
  const [interaction, setInteraction] = useState({ type: 'call', subject: '', note: '', happened_at: '' })
  const [savingInt, setSavingInt] = useState(false)

  const [taskOpen, setTaskOpen] = useState(false)
  const [task, setTask] = useState({ title: '', due_at: '', note: '' })
  const [savingTask, setSavingTask] = useState(false)

  const ordersList = orders ?? []
  const quotesList = quotes ?? []
  const interactionsList = interactions ?? []
  const tasksList = tasks ?? []

  const revenueSum = useMemo(() => ordersList.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.fee, 0), [ordersList])

  const reloadAll = useCallback((): void => {
    refetch()
    refetchQuotes()
    refetchInteractions()
    refetchTasks()
  }, [refetch, refetchQuotes, refetchInteractions, refetchTasks])

  if (error) return <ErrorBox message={error} onRetry={refetch} />

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'info', label: 'ข้อมูล' },
    { key: 'orders', label: 'ออเดอร์', count: detail?.order_count },
    { key: 'quotes', label: 'ใบเสนอราคา', count: quotesList.length },
    { key: 'interactions', label: 'การติดต่อ', count: interactionsList.length },
    { key: 'tasks', label: 'งานติดตาม', count: detail?.open_tasks_count },
  ]

  const addInteraction = async (): Promise<void> => {
    if (!interaction.subject.trim()) { push('warning', 'ระบุหัวข้อการติดต่อ'); return }
    if (!interaction.happened_at) { push('warning', 'ระบุวันเวลาที่ติดต่อ'); return }
    setSavingInt(true)
    try {
      await api.post(`/customers/${customerId}/interactions`, {
        type: interaction.type,
        subject: interaction.subject.trim(),
        note: interaction.note.trim() || null,
        happened_at: new Date(interaction.happened_at).toISOString(),
      })
      push('success', 'บันทึกการติดต่อแล้ว')
      setInteractionOpen(false)
      setInteraction({ type: 'call', subject: '', note: '', happened_at: '' })
      refetchInteractions()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingInt(false)
    }
  }

  const addTask = async (): Promise<void> => {
    if (!task.title.trim()) { push('warning', 'ระบุชื่องานติดตาม'); return }
    setSavingTask(true)
    try {
      await api.post(`/customers/${customerId}/tasks`, {
        title: task.title.trim(),
        due_at: task.due_at ? new Date(task.due_at).toISOString() : null,
        note: task.note.trim() || null,
      })
      push('success', 'เพิ่มงานติดตามแล้ว')
      setTaskOpen(false)
      setTask({ title: '', due_at: '', note: '' })
      refetchTasks()
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingTask(false)
    }
  }

  const toggleTask = async (t: CustomerTask): Promise<void> => {
    try {
      await api.patch(`/customers/${customerId}/tasks/${t.id}/status`, { status: t.status === 'pending' ? 'done' : 'pending' })
      refetchTasks()
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'อัปเดตไม่สำเร็จ')
    }
  }

  const deleteInteraction = async (it: Interaction): Promise<void> => {
    try {
      await api.delete(`/customers/${customerId}/interactions/${it.id}`)
      push('success', 'ลบการติดต่อแล้ว')
      refetchInteractions()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/customers')} icon={<IconChevronLeft size={15} />}>ลูกค้า</Button>
      </div>

      {loading || !detail ? (
        <div className="card"><Skeleton height={120} /></div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h1 className="page-title">{detail.name}</h1>
                {detail.segment && (
                  <>
                    <Badge label={SEGMENT_LABEL[detail.segment as keyof typeof SEGMENT_LABEL] ?? detail.segment} tone={SEGMENT_TONE[detail.segment as keyof typeof SEGMENT_TONE] ?? 'pending'} />
                    <HelpTip text="กลุ่มลูกค้า: VIP = ลูกค้าหลักดูแลเป็นพิเศษ · A/B = ลูกค้าประจำ · C = ลูกค้าทดลองใช้ — ใช้จัดลำดับความสำคัญในการให้บริการและติดตาม" />
                  </>
                )}
              </div>
              <p className="page-subtitle">
                {detail.contact_person && <>ผู้ติดต่อ {detail.contact_person} · </>}
                {detail.phone} {detail.credit_terms ? <>· เครดิต {detail.credit_terms} วัน<HelpTip text={`เครดิต ${detail.credit_terms} วัน = ลูกค้าชำระเงินภายใน ${detail.credit_terms} วัน หลังส่งของเสร็จ (จดไว้เป็นเงื่อนไขการวางบิล)`} /></> : ''}
              </p>
            </div>
            {canEdit && <Button variant="outline" size="sm" onClick={() => navigate('/customers', { state: { edit: detail.id } })}>แก้ไขข้อมูล</Button>}
          </div>

          {/* แถบเมตริกเดียวกับหน้ารายงาน — ทั้งระบบใช้รูปแบบตัวเลขสรุปแบบเดียว */}
          <div className="card metrics-band metrics-band-4">
            <div className="metric-cell">
              <div className="metric-label">ออเดอร์ทั้งหมด</div>
              <div className="metric-num">{fmtNum(detail.order_count)}</div>
              <div className="metric-foot">รายการ</div>
            </div>
            <div className="metric-cell">
              <div className="metric-label">รายได้รวม</div>
              <div className="metric-num">{fmtMoney(revenueSum)}</div>
              <div className="metric-foot">เฉพาะออเดอร์ที่ส่งสำเร็จ</div>
            </div>
            <div className="metric-cell">
              <div className="metric-label">ใบเสนอราคาค้าง</div>
              <div className="metric-num">{fmtNum(detail.pending_quotes_count)}</div>
              <div className="metric-foot">ร่าง / ส่งแล้ว</div>
            </div>
            <div className="metric-cell">
              <div className="metric-label">งานติดตามค้าง</div>
              <div className="metric-num">{fmtNum(detail.open_tasks_count)}</div>
              <div className="metric-foot">ต้องทำ</div>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab${tab === t.key ? ' is-on' : ''}`}
                role="tab"
                aria-selected={tab === t.key}
              >
                {t.label}
                {t.count != null && t.count > 0 && <span className="tab-count">({t.count})</span>}
              </button>
            ))}
          </div>

          {tab === 'info' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
              <div className="card">
                <div className="card-title">ข้อมูลติดต่อ</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
                  <div><span className="text-muted text-sm">ผู้ติดต่อ: </span><b>{detail.contact_person ?? '—'}</b></div>
                  <div><span className="text-muted text-sm">เบอร์โทร: </span><b>{detail.phone ?? '—'}</b></div>
                  <div><span className="text-muted text-sm">อีเมล: </span><b>{detail.email ?? '—'}</b></div>
                  <div><span className="text-muted text-sm">ที่อยู่: </span>{detail.address ?? '—'}</div>
                  <div><span className="text-muted text-sm">เลขภาษี: </span>{detail.tax_id ?? '—'}</div>
                  <div><span className="text-muted text-sm">เงื่อนไขเครดิต: </span>{detail.credit_terms ? `${detail.credit_terms} วัน` : '—'}<HelpTip text="เครดิต = จำนวนวันหลังส่งของที่ลูกค้าต้องชำระเงิน — เช่น เครดิต 30 วัน = วางบิลได้ภายใน 30 วัน" /></div>
                </div>
              </div>
              <div className="card">
                <div className="card-title">ข้อมูลเชิงพาณิชย์</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
                  <div>
                    <span className="text-muted text-sm">แท็ก: </span>
                    {detail.tags ? detail.tags.split(',').map((t) => <Badge key={t} label={t.trim()} tone="pending" />) : '—'}
                  </div>
                  <div><span className="text-muted text-sm">เงื่อนไขราคา: </span>{detail.price_note ?? '—'}</div>
                  <div><span className="text-muted text-sm">ออเดอร์ล่าสุด: </span>{detail.last_order_at ? fmtDateTime(detail.last_order_at) : 'ยังไม่มี'}</div>
                </div>
              </div>
            </div>
          )}

          {tab === 'orders' && (
            <div className="table-wrap">
              {ordersList.length === 0 ? (
                <EmptyState title="ยังไม่มีออเดอร์ของลูกค้านี้" />
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>เลขที่</th><th>เส้นทาง</th><th>สินค้า</th><th className="num">ค่าขนส่ง</th><th>กำหนดส่ง</th><th>สถานะ</th></tr>
                  </thead>
                  <tbody>
                    {ordersList.map((o: Order) => (
                      <tr key={o.id}>
                        <td className="text-strong" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{o.order_no}</td>
                        <td className="text-sm">{o.origin} → {o.destination}</td>
                        <td className="text-sm">{o.goods_desc}</td>
                        <td className="num">{fmtMoney(o.fee)}</td>
                        <td className="text-sm">{fmtDate(o.scheduled_at)}</td>
                        <td><Badge label={ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL] ?? o.status} tone={ORDER_TONE[o.status as keyof typeof ORDER_TONE] ?? 'pending'} dot={o.status === 'in_transit'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'quotes' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 16 }}>
                ใบเสนอราคาของลูกค้านี้
                {canEdit && <Button variant="outline" size="sm" icon={<IconPlus size={14} />} onClick={() => navigate('/quotes')}>ดูทั้งหมด / สร้างใหม่</Button>}
              </div>
              {quotesList.length === 0 ? (
                <EmptyState title="ยังไม่มีใบเสนอราคา" desc="สร้างใบเสนอราคาได้จากหน้าใบเสนอราคา" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {quotesList.map((q: Quote) => (
                    <Link key={q.id} to="/quotes" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)', textDecoration: 'none', color: 'var(--ink)' }}>
                      <span className="text-strong" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{q.quote_no}</span>
                      <span className="text-sm text-muted">{q.origin} → {q.destination}</span>
                      <span className="text-sm" style={{ flex: 1 }}>{q.goods_desc} · {fmtNum(q.weight_kg)} กก.</span>
                      <span className="text-strong">{fmtMoney(q.fee)}</span>
                      <Badge label={QUOTE_STATUS_LABEL[q.status as keyof typeof QUOTE_STATUS_LABEL] ?? q.status} tone={QUOTE_TONE[q.status as keyof typeof QUOTE_TONE] ?? 'pending'} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'interactions' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 16 }}>
                ประวัติการติดต่อ
                {canEdit && <Button variant="accent" size="sm" icon={<IconPlus size={14} />} onClick={() => setInteractionOpen(true)}>บันทึกการติดต่อ</Button>}
              </div>
              {interactionsList.length === 0 ? (
                <EmptyState title="ยังไม่มีการติดต่อที่บันทึก" desc="บันทึกการโทร/อีเมล/ประชุมกับลูกค้าเพื่อไม่ให้หลุดประเด็น" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {interactionsList.map((it: Interaction) => (
                    <div key={it.id} style={{ display: 'flex', gap: 12, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)' }}>
                      <div style={{ fontSize: 20 }}>{INTERACTION_TYPE_ICON[it.type] ?? '📌'}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge label={INTERACTION_TYPE_LABEL[it.type] ?? it.type} tone="assigned" />
                          <b>{it.subject}</b>
                        </div>
                        {it.note && <div className="text-sm text-muted" style={{ marginTop: 4, lineHeight: 1.6 }}>{it.note}</div>}
                        <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                          {fmtDateTime(it.happened_at)} · โดย {it.created_by_name ?? '—'}
                        </div>
                      </div>
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="text-danger" title="ลบ" onClick={() => deleteInteraction(it)}><IconTrash size={13} /></Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 16 }}>
                งานติดตาม
                {canEdit && <Button variant="accent" size="sm" icon={<IconPlus size={14} />} onClick={() => setTaskOpen(true)}>เพิ่มงาน</Button>}
              </div>
              {tasksList.length === 0 ? (
                <EmptyState title="ไม่มีงานติดตาม" desc="เพิ่มนัดหมาย/การติดตามลูกค้า เช่น โทรเสนอราคา" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tasksList.map((t: CustomerTask) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 12, background: t.status === 'done' ? 'transparent' : 'var(--surface-2)', opacity: t.status === 'done' ? 0.55 : 1 }}>
                      <button
                        onClick={() => toggleTask(t)}
                        style={{ width: 22, height: 22, borderRadius: 7, border: '1.5px solid var(--line-strong)', background: t.status === 'done' ? 'var(--success)' : 'var(--surface)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title={t.status === 'pending' ? 'ทำเสร็จแล้ว' : 'กลับเป็นค้าง'}
                      >
                        {t.status === 'done' && <IconCheck size={13} />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined, fontWeight: 600 }}>{t.title}</div>
                        {t.note && <div className="text-xs text-muted">{t.note}</div>}
                      </div>
                      <div className="text-xs" style={{ color: t.due_at && new Date(t.due_at) < new Date() && t.status === 'pending' ? 'var(--danger)' : 'var(--muted)' }}>
                        {t.due_at ? `ครบกำหนด ${fmtDate(t.due_at)}` : 'ไม่ระบุวันที่'}
                      </div>
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="text-danger" title="ลบ" onClick={async () => { await api.delete(`/customers/${customerId}/tasks/${t.id}`); refetchTasks(); refetch() }}><IconTrash size={13} /></Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Modal
        open={interactionOpen}
        onClose={() => setInteractionOpen(false)}
        title="บันทึกการติดต่อลูกค้า"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInteractionOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={addInteraction} loading={savingInt}>บันทึก</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="ประเภท" required>
            <Select value={interaction.type} onChange={(e) => setInteraction({ ...interaction, type: e.target.value })}>
              {Object.entries(INTERACTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="วันเวลา" required>
            <Input type="datetime-local" value={interaction.happened_at} onChange={(e) => setInteraction({ ...interaction, happened_at: e.target.value })} />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="หัวข้อ" required>
              <Input value={interaction.subject} onChange={(e) => setInteraction({ ...interaction, subject: e.target.value })} placeholder="เช่น โทรสอบถามกำหนดส่งล็อตใหม่" />
            </Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="รายละเอียด">
              <Textarea value={interaction.note} onChange={(e) => setInteraction({ ...interaction, note: e.target.value })} placeholder="สรุปสาระสำคัญของการติดต่อครั้งนี้" />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        title="เพิ่มงานติดตาม"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTaskOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={addTask} loading={savingTask}>เพิ่มงาน</Button>
          </>
        }
      >
        <div className="form-grid">
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="ชื่องาน" required>
              <Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="เช่น โทรติดตามใบเสนอราคา" />
            </Field>
          </div>
          <Field label="ครบกำหนด">
            <Input type="date" value={task.due_at} onChange={(e) => setTask({ ...task, due_at: e.target.value })} />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="หมายเหตุ">
              <Textarea value={task.note} onChange={(e) => setTask({ ...task, note: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </>
  )
}
