import fs from "fs";
import { parseStringPromise } from "xml2js";
import { GpxPoint, GpxSegment } from "./types";

const SEGMENT_COLORS = [
  "#d00000",
  "#0066ff",
  "#00a86b",
  "#ff8c00",
  "#7b2cbf",
  "#111111",
  "#00b4d8",
  "#9d0208",
  "#2d6a4f",
  "#f72585",
];

export function colorForIndex(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
}

function haversineMeters(a: GpxPoint, b: GpxPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function extractPoints(gpx: any): GpxPoint[] {
  const points: GpxPoint[] = [];
  const tracks = toArray(gpx?.gpx?.trk);
  for (const trk of tracks) {
    const segments = toArray(trk?.trkseg);
    for (const seg of segments) {
      const trkpts = toArray(seg?.trkpt);
      for (const pt of trkpts) {
        const lat = parseFloat(pt?.$?.lat);
        const lon = parseFloat(pt?.$?.lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
        const timeStr = firstText(pt?.time);
        const time = timeStr ? new Date(timeStr) : undefined;
        points.push({
          lat,
          lon,
          time: time && !isNaN(time.getTime()) ? time : undefined,
        });
      }
    }
  }
  if (points.length === 0) {
    const routes = toArray(gpx?.gpx?.rte);
    for (const rte of routes) {
      const rtepts = toArray(rte?.rtept);
      for (const pt of rtepts) {
        const lat = parseFloat(pt?.$?.lat);
        const lon = parseFloat(pt?.$?.lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
        const timeStr = firstText(pt?.time);
        const time = timeStr ? new Date(timeStr) : undefined;
        points.push({
          lat,
          lon,
          time: time && !isNaN(time.getTime()) ? time : undefined,
        });
      }
    }
  }
  return points;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function firstText(v: any): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return firstText(v[0]);
  if (typeof v === "string") return v;
  if (typeof v === "object" && "_" in v) return v._;
  return undefined;
}

export async function parseGpxFile(
  filePath: string,
  displayName: string,
  index: number
): Promise<GpxSegment> {
  const xml = fs.readFileSync(filePath, "utf8");
  const parsed = await parseStringPromise(xml, { explicitArray: false });
  const points = extractPoints(parsed);

  let distanceMeters = 0;
  for (let i = 1; i < points.length; i++) {
    distanceMeters += haversineMeters(points[i - 1], points[i]);
  }
  const distanceNm = distanceMeters / 1852;

  const timed = points.filter((p) => p.time);
  let durationHours: number | null = null;
  let averageSpeedKt: number | null = null;
  if (timed.length >= 2) {
    const times = timed.map((p) => p.time!.getTime());
    const ms = Math.max(...times) - Math.min(...times);
    if (ms > 0) {
      durationHours = ms / 3600000;
      averageSpeedKt = distanceNm / durationHours;
    }
  }

  return {
    name: displayName,
    color: colorForIndex(index),
    points,
    distanceNm,
    durationHours,
    averageSpeedKt,
  };
}
