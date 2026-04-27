export interface GpxPoint {
  lat: number;
  lon: number;
  time?: Date;
}

export interface GpxSegment {
  name: string;
  color: string;
  points: GpxPoint[];
  distanceNm: number;
  durationHours: number | null;
  averageSpeedKt: number | null;
}

export interface SessionState {
  files: { path: string; originalName: string }[];
}
