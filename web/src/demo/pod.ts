/** แทน api/pod — จอสาธิตไม่มีหลักฐานเก่าให้เปิดดู */
export interface PodPhotoView { path: string; kind: string; url: string }

export interface PodView {
  id: number
  order_id: number
  recipient_name: string
  signature_data: string
  notes: string | null
  status: 'collected' | 'verified'
  lat: number | null
  lng: number | null
  collected_at: string
  updated_at: string
  collected_by_name: string | null
  photos: PodPhotoView[]
}

export async function podOfOrder(_orderId: number): Promise<PodView | null> { return null }

export async function verifyPod(podId: number): Promise<{ id: number; status: 'verified'; already: boolean }> {
  return { id: podId, status: 'verified', already: false }
}

export async function unverifyPod(podId: number, _reason: string): Promise<{ id: number; status: string; already: boolean }> {
  return { id: podId, status: 'collected', already: false }
}
