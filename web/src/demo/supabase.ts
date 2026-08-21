/**
 * แทน api/supabase เฉพาะที่ hooks/useRealtime เรียกใช้
 *
 * โหมดสาธิตไม่มีฐานข้อมูลอยู่ปลายทาง ปล่อยตัวจริงไว้เท่ากับให้เบราว์เซอร์พยายาม
 * เปิด websocket ไปหา demo.invalid ซ้ำ ๆ แล้วพ่น error เต็ม console
 * จนของที่ควรอ่านจริงถูกกลบ
 *
 * ช่องนี้คืนช่องเปล่าที่ไม่มี event เข้ามาเลย ซึ่งตรงกับความจริง: ข้อมูลสาธิต
 * เปลี่ยนได้จากแท็บนี้แท็บเดียว ไม่มีใครอื่นมาแก้พร้อมกัน
 */
interface DemoChannel {
  on: () => DemoChannel
  subscribe: () => DemoChannel
}

const channel = (): DemoChannel => {
  const ch: DemoChannel = {
    on: () => ch,
    subscribe: () => ch,
  }
  return ch
}

export const supabase = {
  channel,
  removeChannel: () => {},
}
