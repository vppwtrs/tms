/** แทน api/tracking — พิกัดที่คนขับส่งระหว่างสาธิตถูกทิ้ง ไม่เก็บที่ไหนเลย */
export interface TrackPoint {
  lat: number
  lng: number
  recorded_at: string
  speed_kph: number | null
  accuracy_m: number | null
}

export interface TrackedTrip {
  trip_id: number
  trip_no: string
  plate_no: string | null
  driver_name: string | null
  last: TrackPoint | null
}

export async function logTripLocation(
  _tripId: number,
  _lat: number,
  _lng: number,
  _accuracyM?: number | null,
): Promise<void> {}
export async function trackingBoard(): Promise<TrackedTrip[]> { return [] }
export async function tripTrack(_tripId: number): Promise<TrackPoint[]> { return [] }
