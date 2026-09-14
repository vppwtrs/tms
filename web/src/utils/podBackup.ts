import type { CompressedImage } from './image'

/**
 * สำรองรูป POD ลง IndexedDB ของเครื่อง — กันรูปหายเมื่อเน็ตหลุดตอนอัปโหลด
 *
 * ถ่ายรูปเสร็จ รูปเซฟลงเครื่องทันที ก่อนที่จะรู้ด้วยซ้ำว่าอัปโหลดจะสำเร็จไหม
 * ถ้าอัปสำเร็จ ลบสำเนาทิ้ง ถ้าเน็ตหลุดหรือแอปถูกปิดกลางคัน สำเนายังอยู่
 * เปิดฟอร์มร้านเดิมอีกครั้งจึงกู้กลับมาได้โดยไม่ต้องถ่ายใหม่
 *
 * ไม่ใช้ localStorage เพราะรูปเป็น Blob หลักร้อย KB ต่อใบ เก็บใน IndexedDB
 * ตรง ๆ ได้ ไม่ต้องแปลงเป็น base64 ซึ่งบวมขึ้นราวหนึ่งในสาม
 *
 * ทุกฟังก์ชันกลืน error เอง (คืนค่าว่าง/ไม่ทำอะไร) — การสำรองพังไม่ควรทำให้
 * ถ่ายรูปหรืออัปโหลดพังตาม เบราว์เซอร์บางตัว (Safari โหมดส่วนตัว) ปิด IndexedDB ไว้เลย
 */

const DB_NAME = 'tms-pod-backup'
const STORE = 'shots'

interface ShotRecord {
  id: string
  orderId: number
  kind: string
  blob: Blob
  ext: CompressedImage['ext']
  type: CompressedImage['type']
  width: number
  height: number
  bytes: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('orderId', 'orderId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** เซฟรูปที่เพิ่งถ่ายลงเครื่อง — เรียกทันทีหลังชัตเตอร์ลั่น ไม่ต้องรอผล */
export async function saveShotBackup(
  orderId: number,
  id: string,
  kind: string,
  img: CompressedImage,
): Promise<void> {
  try {
    const db = await openDb()
    const record: ShotRecord = {
      id, orderId, kind, blob: img.blob, ext: img.ext, type: img.type,
      width: img.width, height: img.height, bytes: img.bytes,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // สำรองพัง ไม่ทำให้ถ่ายรูปพังตาม
  }
}

/** ดึงรูปที่ค้างสำรองไว้ของร้านนี้กลับมา — ใช้ตอนเปิดฟอร์มแล้วเจอรูปตกค้างจากรอบก่อน */
export async function listShotBackups(
  orderId: number,
): Promise<Array<{ backupId: string; kind: string; img: CompressedImage }>> {
  try {
    const db = await openDb()
    const records = await new Promise<ShotRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).index('orderId').getAll(orderId)
      req.onsuccess = () => resolve(req.result as ShotRecord[])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return records.map((r) => ({
      backupId: r.id,
      kind: r.kind,
      img: {
        blob: r.blob, ext: r.ext, type: r.type,
        url: URL.createObjectURL(r.blob), width: r.width, height: r.height, bytes: r.bytes,
      },
    }))
  } catch {
    return []
  }
}

/** ลบสำเนาของรูปใบเดียว — เรียกทันทีที่รูปนั้นอัปโหลดขึ้นระบบสำเร็จ หรือถูกลบด้วยมือ */
export async function removeShotBackup(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ไม่มีอะไรต้องทำต่อ — เก็บตกไว้ก็แค่กินที่ว่างนิดหน่อย
  }
}

/** ล้างสำรองทั้งร้าน — เรียกหลังบันทึก POD สำเร็จครบทั้งรูปและลายเซ็น */
export async function clearOrderBackup(orderId: number): Promise<void> {
  try {
    const db = await openDb()
    const ids = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).index('orderId').getAllKeys(orderId)
      req.onsuccess = () => resolve(req.result as string[])
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      ids.forEach((id) => store.delete(id))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // เก็บตกไว้ก็แค่กินที่ว่างนิดหน่อย
  }
}
