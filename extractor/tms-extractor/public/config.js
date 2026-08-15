/* ตั้งค่าปลายทาง Supabase
 *
 * anon key เป็นคีย์สาธารณะโดยการออกแบบ — มันอยู่ในหน้าเว็บของทุกแอปที่ใช้ Supabase
 * สิ่งที่กันคนแปลกหน้าคือ RLS + การล็อกอิน ไม่ใช่การซ่อนคีย์นี้
 *
 * ห้ามเอา service_role key มาใส่ตรงนี้เด็ดขาด — ตัวนั้นข้าม RLS ทั้งหมด
 *
 * ปล่อยว่างได้ หน้าจอจะถามแล้วจำไว้ใน localStorage ของเครื่องนั้น
 */
window.SB_CONFIG = {
  url: 'https://ypkwavdtkhgvhuacwgla.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwa3dhdmR0a2hndmh1YWN3Z2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2ODY1OTIsImV4cCI6MjEwMjI2MjU5Mn0.InLPaAmITI5fGfh7NvxvSgvJMNtsexlilhPzXHkwxQ0'
};
