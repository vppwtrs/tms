/** แทน api/storage — รูปไม่ถูกอัปโหลดไปไหน เก็บเป็น blob URL ในแท็บ */
const blobs = new Map<string, string>()

export function podPhotoPath(orderId: number, ext = 'jpg'): string {
  return `demo/${orderId}/${Date.now()}.${ext}`
}

export async function uploadPodPhoto(
  orderId: number,
  file: Blob,
  kind: { ext: string; type: string } = { ext: 'jpg', type: 'image/jpeg' },
): Promise<string> {
  const path = podPhotoPath(orderId, kind.ext)
  blobs.set(path, URL.createObjectURL(file))
  return path
}

export async function podPhotoUrl(path: string): Promise<string> {
  return blobs.get(path) ?? ''
}

export async function removePodPhotos(paths: string[]): Promise<number> {
  let n = 0
  for (const p of paths) {
    const url = blobs.get(p)
    if (url) { URL.revokeObjectURL(url); blobs.delete(p); n++ }
  }
  return n
}
