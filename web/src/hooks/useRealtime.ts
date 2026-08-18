import { useEffect, useRef } from 'react'
import { supabase } from '../api/supabase'

/**
 * ฟังการเปลี่ยนแปลงของตารางผ่าน Supabase Realtime แล้วสั่งโหลดข้อมูลใหม่
 *
 * เดิมทุกหน้าดึงข้อมูลครั้งเดียวตอน mount แล้วไม่รู้เรื่องอีกเลยจนกว่าคนใช้จะกดรีเฟรช
 * มีแค่หน้าดึงข้อมูลจาก TMS ที่ตั้ง setInterval ไว้ 5 นาที ซึ่งไม่ใช่เรียลไทม์
 * และหยุดทันทีที่ปิดแท็บ
 *
 * ตัวนี้ไม่เอา payload ของ event มาแก้ state ตรง ๆ ตั้งใจให้ event เป็นแค่สัญญาณ
 * ว่า "ของเปลี่ยนแล้ว ไปถามใหม่" เพราะหน้าส่วนใหญ่แสดงข้อมูลที่ join มาจากหลายตาราง
 * การเอาแถวดิบมาแปะทับจะได้ข้อมูลที่ไม่ครบและเพี้ยนจากที่ query ให้มา
 *
 * ต้องเปิด publication ฝั่งฐานก่อน (supabase/migrations/20260818000000_trip_sync_fix.sql)
 * ตารางที่ไม่อยู่ใน publication จะ subscribe ผ่านแต่ไม่มี event มาเลย
 *
 * RLS ยังคุมอยู่ — คนใช้จะได้ event เฉพาะแถวที่ตัวเองมีสิทธิ์อ่าน
 */
export function useRealtime(tables: string[], onChange: () => void, enabled = true): void {
  const cbRef = useRef(onChange)
  cbRef.current = onChange
  /* ตารางถูกส่งมาเป็น literal array ใหม่ทุก render — ผูก effect กับข้อความที่ join แล้ว
     ไม่งั้น channel จะถูก unsubscribe/subscribe ใหม่ทุกครั้งที่หน้า re-render */
  const key = tables.join(',')

  useEffect(() => {
    if (!enabled || !key) return
    let timer: ReturnType<typeof setTimeout> | null = null

    /* หนึ่ง push ของ TMS ทำให้หลายตารางขยับพร้อมกันเป็นสิบ event
       รวบให้เหลือโหลดรอบเดียว ไม่งั้นหน้าจะยิง query รัวจนสะดุด */
    const ping = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => cbRef.current(), 400)
    }

    const channel = supabase.channel(`rt:${key}`)
    for (const table of key.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, ping)
    }
    void channel.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [key, enabled])
}
