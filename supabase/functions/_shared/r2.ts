import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'

/** เซ็นคำขอ S3 ให้ R2 — SigV4 คำนวณในเครื่อง ไม่มี network hop เพิ่ม
 *  R2 ใช้ region 'auto' service 's3' และ endpoint แยกตาม account */
const accountId = () => Deno.env.get('R2_ACCOUNT_ID')!
const bucket = () => Deno.env.get('R2_BUCKET') ?? 'pod-photos'

const client = () =>
  new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    region: 'auto',
    service: 's3',
  })

/** key อาจมี '/' (โฟลเดอร์ตามออเดอร์) — encode ทีละส่วน คง '/' ไว้ */
const objectUrl = (key: string) =>
  `https://${accountId()}.r2.cloudflarestorage.com/${bucket()}/` +
  key.split('/').map(encodeURIComponent).join('/')

export async function r2Put(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), {
    method: 'PUT',
    body,
    headers: { 'content-type': contentType },
  })
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${await res.text().catch(() => '')}`)
}

export async function r2Delete(key: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), { method: 'DELETE' })
  /* R2 ตอบ 204 เมื่อสำเร็จ, 404 = ไฟล์ไม่มีอยู่แล้ว ซึ่งคือผลลัพธ์ที่ต้องการอยู่ดี */
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`)
}

/** ลิงก์อ่านรูปแบบมีอายุ — เซ็นใส่ query string เปิดใน <img src> ได้ตรง ๆ */
export async function r2SignGet(key: string, expiresSec = 600): Promise<string> {
  const url = new URL(objectUrl(key))
  url.searchParams.set('X-Amz-Expires', String(expiresSec))
  const signed = await client().sign(url.toString(), { method: 'GET', aws: { signQuery: true } })
  return signed.url
}
