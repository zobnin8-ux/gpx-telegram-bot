import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GpxSegment } from "./types";

export interface GeneratedMap {
  mapId: string;
  url: string;
  filePath: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNm(nm: number): string {
  return `${nm.toFixed(1)} NM`;
}

function fmtKt(kt: number | null): string {
  return kt === null ? "N/A" : `${kt.toFixed(1)} kt`;
}

export function generateMap(
  segments: GpxSegment[],
  publicMapsDir: string,
  baseUrl: string
): GeneratedMap {
  const mapId = crypto.randomUUID();
  const dir = path.join(publicMapsDir, mapId);
  fs.mkdirSync(dir, { recursive: true });

  const segmentData = segments.map((s, i) => ({
    name: s.name || `Segment ${i + 1}`,
    color: s.color,
    coords: s.points.map((p) => [p.lat, p.lon]),
    distanceLabel: fmtNm(s.distanceNm),
    speedLabel: fmtKt(s.averageSpeedKt),
  }));

  const json = JSON.stringify(segmentData);
  const html = renderHtml(json);
  const filePath = path.join(dir, "index.html");
  fs.writeFileSync(filePath, html, "utf8");

  const cleanBase = baseUrl.replace(/\/+$/, "");
  return {
    mapId,
    url: `${cleanBase}/maps/${mapId}/index.html`,
    filePath,
  };
}

function renderHtml(segmentsJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>GPX Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  #map { position: absolute; inset: 0; }
  .legend {
    background: rgba(255, 255, 255, 0.92);
    padding: 12px 14px;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-size: 13px;
    color: #222;
    line-height: 1.45;
    max-width: 280px;
  }
  .legend h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 600;
    color: #111;
  }
  .legend .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0;
  }
  .legend .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex: 0 0 auto;
    margin-top: 2px;
  }
  .legend .meta {
    color: #555;
    font-size: 12px;
  }
  .leaflet-popup-content {
    font-size: 13px;
    line-height: 1.45;
  }
  .leaflet-popup-content b { color: #111; }
  @media (max-width: 600px) {
    .legend { max-width: 70vw; font-size: 12px; }
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const segments = ${segmentsJson};

  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const allLatLngs = [];
  segments.forEach((seg) => {
    if (!seg.coords || seg.coords.length === 0) return;
    const line = L.polyline(seg.coords, {
      color: seg.color,
      weight: 5,
      opacity: 0.92,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    const popup =
      '<b>' + escapeHtml(seg.name) + '</b><br>' +
      'Distance: ' + escapeHtml(seg.distanceLabel) + '<br>' +
      'Average speed: ' + escapeHtml(seg.speedLabel);
    line.bindPopup(popup);
    seg.coords.forEach(c => allLatLngs.push(c));
  });

  if (allLatLngs.length > 0) {
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [30, 30] });
  } else {
    map.setView([0, 0], 2);
  }

  const legend = L.control({ position: 'topright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    let html = '<h4>Segments</h4>';
    segments.forEach((seg) => {
      html +=
        '<div class="row">' +
          '<div class="swatch" style="background:' + seg.color + '"></div>' +
          '<div>' +
            '<div><b>' + escapeHtml(seg.name) + '</b></div>' +
            '<div class="meta">' + escapeHtml(seg.distanceLabel) + ' &middot; ' + escapeHtml(seg.speedLabel) + '</div>' +
          '</div>' +
        '</div>';
    });
    div.innerHTML = html;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  legend.addTo(map);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
</script>
</body>
</html>
`;
}

export { escapeHtml };
