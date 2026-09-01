/**
 * เซ็นคำขอ S3 (SigV4) ให้ Cloudflare R2 — เขียนเองด้วย node:crypto ไม่พึ่ง SDK
 *
 * เหตุผลเดียวกับ backup-pod-photos.mjs: สคริปต์พวกนี้ต้องรันบนเครื่องออฟฟิศที่มีแค่ Node
 * ไม่มี npm install ไม่มี node_modules ให้พัง
 *
 * R2 ใช้ region 'auto' service 's3' payload ต้องเซ็นจริง (ไม่รับ UNSIGNED-PAYLOAD)
 */

import { createHash, createHmac } from 'node:crypto'

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')
const hmac = (key, str) => createHmac('sha256', key).update(str).digest()

export function r2Client({ accountId, accessKeyId, secretAccessKey, bucket }) {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('r2Client: ต้องมี accountId, accessKeyId, secretAccessKey, bucket ครบ')
  }
  const host = `${accountId}.r2.cloudflarestorage.com`
  const region = 'auto'
  const service = 's3'

  async function signedFetch(method, key, { body = Buffer.alloc(0), contentType } = {}) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8)
    const canonicalUri = '/' + bucket + '/' + key.split('/').map(encodeURIComponent).join('/')
    const payloadHash = sha256hex(body)

    const headerMap = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    if (contentType) headerMap['content-type'] = contentType
    const names = Object.keys(headerMap).sort()
    const signedHeaders = names.join(';')
    const canonicalHeaders = names.map((n) => `${n}:${headerMap[n]}\n`).join('')

    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${dateStamp}/${region}/${service}/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')

    let k = hmac('AWS4' + secretAccessKey, dateStamp)
    k = hmac(k, region)
    k = hmac(k, service)
    k = hmac(k, 'aws4_request')
    const signature = createHmac('sha256', k).update(stringToSign).digest('hex')

    headerMap['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    return fetch(`https://${host}${canonicalUri}`, {
      method,
      headers: headerMap,
      body: body.length ? body : undefined,
      signal: AbortSignal.timeout(30000),
    })
  }

  return {
    /** true = มีไฟล์นี้แล้ว */
    async has(key) {
      const res = await signedFetch('HEAD', key)
      if (res.status === 200) return true
      if (res.status === 404) return false
      throw new Error(`R2 HEAD ${key} -> ${res.status}`)
    },
    async get(key) {
      const res = await signedFetch('GET', key)
      if (!res.ok) throw new Error(`R2 GET ${key} -> ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async put(key, buf, contentType) {
      const res = await signedFetch('PUT', key, { body: buf, contentType })
      if (!res.ok) throw new Error(`R2 PUT ${key} -> ${res.status} ${await res.text().catch(() => '')}`)
    },
  }
}
