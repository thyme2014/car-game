export type SurfaceType = 'asphalt' | 'pad' | 'shoulder' | 'grass' | 'sand';

export interface RoadPoint {
  x: number;
  z: number;
  y: number;
  width: number;
}

export interface RoadSegment {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  dx: number;
  dz: number;
  lenSq: number;
  len: number;
  width: number;
}

export interface RoadSample {
  distance: number;
  roadWidth: number;
  elevation: number;
  surface: SurfaceType;
  tangentX: number;
  tangentZ: number;
}

export interface WorldCollider {
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
  kind: 'building' | 'tower' | 'rock' | 'tree' | 'silo' | 'lighthouse';
}

export interface WorldBuildingSpec {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  style: 'glass' | 'concrete' | 'warehouse' | 'brick';
}

export interface LandmarkInfo {
  id: string;
  name: string;
  x: number;
  z: number;
  shortLabel: string;
}

export const WORLD_HALF_EXTENT = 240;
export const SEA_LEVEL = -1.6;

// Closed outer highway loop (clockwise)
const OUTER_LOOP_CTRL: Array<[number, number, number]> = [
  [-120, 118, 13.5], // South-West Coastal Straight
  [0, 128, 14.0],    // Spawn Grand Boulevard
  [120, 118, 13.5],  // South-East Canyon Approach
  [158, 52, 13.0],   // Proving Ground East Curve
  [148, -45, 12.5],  // Foothill Climb Start
  [118, -125, 12.0], // Mountain Ridge Sweep
  [25, -148, 12.5],  // North Valley Straight
  [-85, -135, 13.0], // North-West Overpass Approach
  [-146, -65, 13.5], // Downtown West Avenue
  [-155, 38, 13.5],  // Harbor Front Causeway
];

// Cross-valley boulevard connecting West Downtown/Harbor to East Proving Ground
const CROSS_ROAD_CTRL: Array<[number, number, number]> = [
  [-146, -20, 12.0],
  [-68, -14, 12.0],
  [0, 0, 12.5],
  [78, 16, 12.0],
  [154, 40, 12.0],
];

// Mountain Observatory Summit spur branching off North-East ridge
const SUMMIT_SPUR_CTRL: Array<[number, number, number]> = [
  [118, -125, 11.0],
  [158, -148, 10.5],
  [184, -112, 10.5],
  [168, -74, 10.5],
  [192, -168, 11.0],
];

// Harbor Pier spur
const HARBOR_SPUR_CTRL: Array<[number, number, number]> = [
  [-155, 38, 11.0],
  [-184, 62, 11.0],
  [-176, 98, 11.0],
];

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Natural base terrain elevation before road grading.
 */
export function rawTerrainHeightAt(x: number, z: number): number {
  // Coastal ocean depression in South-West corner
  const bayDist = Math.hypot(x + 215, z - 165);
  const bayCarve = bayDist < 120 ? -3.4 * Math.pow(1 - bayDist / 120, 1.5) : 0;

  // Mountain massif in North-East quadrant (Observatory Summit)
  const peakDist = Math.hypot(x - 185, z + 160);
  const summitHill = peakDist < 145 ? 19.5 * Math.pow(Math.max(0, 1 - peakDist / 145), 1.65) : 0;

  // Secondary canyon ridge South-East
  const canyonDist = Math.hypot(x - 195, z - 125);
  const canyonRidge = canyonDist < 95 ? 8.5 * Math.pow(Math.max(0, 1 - canyonDist / 95), 1.5) : 0;

  // North-West gentle hills behind downtown
  const nwHillDist = Math.hypot(x + 175, z + 175);
  const nwHill = nwHillDist < 105 ? 7.0 * Math.pow(Math.max(0, 1 - nwHillDist / 105), 1.6) : 0;

  // Gentle rolling valley undulation
  const rolling =
    Math.sin(x * 0.018) * Math.cos(z * 0.018) * 1.1 +
    Math.sin(x * 0.042 + z * 0.031) * 0.45;

  // Keep central valley & spawn boulevard calm and natural
  const centerFlatFactor = Math.min(1, Math.hypot(x, z) / 65);
  const base = rolling * (0.25 + 0.75 * centerFlatFactor) + summitHill + canyonRidge + nwHill + bayCarve;

  // Outer perimeter mountain rim beyond playable basin
  const edgeDist = Math.max(Math.abs(x), Math.abs(z));
  const rim = edgeDist > 215 ? ((edgeDist - 215) / 25) * 9.5 : 0;

  return Math.max(SEA_LEVEL - 1.5, base + rim);
}

function sampleSpline(
  ctrl: Array<[number, number, number]>,
  closed: boolean,
  samplesPerSeg: number,
): RoadPoint[] {
  const pts: RoadPoint[] = [];
  const n = ctrl.length;
  const segCount = closed ? n : n - 1;

  for (let i = 0; i < segCount; i++) {
    const idx = (k: number) => (closed ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k)));
    const p0 = ctrl[idx(i - 1)];
    const p1 = ctrl[idx(i)];
    const p2 = ctrl[idx(i + 1)];
    const p3 = ctrl[idx(i + 2)];

    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const x = catmullRom(p0[0], p1[0], p2[0], p3[0], t);
      const z = catmullRom(p0[1], p1[1], p2[1], p3[1], t);
      const width = catmullRom(p0[2], p1[2], p2[2], p3[2], t);
      const y = Math.max(0.15, rawTerrainHeightAt(x, z));
      pts.push({ x, z, y, width });
    }
  }
  if (!closed) {
    const last = ctrl[n - 1];
    pts.push({
      x: last[0],
      z: last[1],
      y: Math.max(0.15, rawTerrainHeightAt(last[0], last[1])),
      width: last[2],
    });
  }
  return pts;
}

function buildSegments(points: RoadPoint[], closed: boolean): RoadSegment[] {
  const segs: RoadSegment[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) continue;
    segs.push({
      ax: a.x,
      az: a.z,
      ay: a.y,
      bx: b.x,
      bz: b.z,
      by: b.y,
      dx,
      dz,
      lenSq,
      len: Math.sqrt(lenSq),
      width: 0.5 * (a.width + b.width),
    });
  }
  return segs;
}

export const OUTER_LOOP_POINTS = sampleSpline(OUTER_LOOP_CTRL, true, 10);
export const CROSS_ROAD_POINTS = sampleSpline(CROSS_ROAD_CTRL, false, 8);
export const SUMMIT_SPUR_POINTS = sampleSpline(SUMMIT_SPUR_CTRL, false, 10);
export const HARBOR_SPUR_POINTS = sampleSpline(HARBOR_SPUR_CTRL, false, 6);

// Smooth elevation along road splines to prevent sudden dips
function smoothRoadElevations(points: RoadPoint[], closed: boolean, passes = 4): void {
  const n = points.length;
  for (let p = 0; p < passes; p++) {
    const nextY = points.map((pt) => pt.y);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const prev = points[(i - 1 + n) % n].y;
      const curr = points[i].y;
      const next = points[(i + 1) % n].y;
      nextY[i] = prev * 0.25 + curr * 0.5 + next * 0.25;
    }
    for (let i = 0; i < n; i++) points[i].y = nextY[i];
  }
}

smoothRoadElevations(OUTER_LOOP_POINTS, true, 6);
smoothRoadElevations(CROSS_ROAD_POINTS, false, 4);
smoothRoadElevations(SUMMIT_SPUR_POINTS, false, 5);
smoothRoadElevations(HARBOR_SPUR_POINTS, false, 3);

export const ALL_ROAD_RIBBONS: Array<{ points: RoadPoint[]; closed: boolean }> = [
  { points: OUTER_LOOP_POINTS, closed: true },
  { points: CROSS_ROAD_POINTS, closed: false },
  { points: SUMMIT_SPUR_POINTS, closed: false },
  { points: HARBOR_SPUR_POINTS, closed: false },
];

const ALL_ROAD_SEGMENTS: RoadSegment[] = [
  ...buildSegments(OUTER_LOOP_POINTS, true),
  ...buildSegments(CROSS_ROAD_POINTS, false),
  ...buildSegments(SUMMIT_SPUR_POINTS, false),
  ...buildSegments(HARBOR_SPUR_POINTS, false),
];

// Proving Ground paved drift pad centered at (112, 62), radius 34m
export const PROVING_PAD = {
  x: 112,
  z: 62,
  radius: 34,
};

export function getRoadInfoAt(x: number, z: number): RoadSample {
  let minDistSq = Infinity;
  let bestSeg: RoadSegment | null = null;
  let bestT = 0;

  for (let i = 0; i < ALL_ROAD_SEGMENTS.length; i++) {
    const seg = ALL_ROAD_SEGMENTS[i];
    const vx = x - seg.ax;
    const vz = z - seg.az;
    let t = (vx * seg.dx + vz * seg.dz) / seg.lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const px = seg.ax + seg.dx * t;
    const pz = seg.az + seg.dz * t;
    const distSq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      bestSeg = seg;
      bestT = t;
    }
  }

  const dist = Math.sqrt(minDistSq);
  const seg = bestSeg!;
  const halfW = seg.width * 0.5;
  const roadElev = seg.ay + (seg.by - seg.ay) * bestT;
  const invLen = 1 / seg.len;

  // Check if inside the paved Industrial Proving Ground skidpad
  const padDist = Math.hypot(x - PROVING_PAD.x, z - PROVING_PAD.z);
  const onPad = padDist <= PROVING_PAD.radius;

  let surface: SurfaceType = 'grass';
  if (dist <= halfW) {
    surface = 'asphalt';
  } else if (onPad) {
    surface = 'pad';
  } else if (dist <= halfW + 3.2) {
    surface = 'shoulder';
  } else if (rawTerrainHeightAt(x, z) < 0.35 && x < -70 && z > 40) {
    surface = 'sand';
  }

  return {
    distance: dist,
    roadWidth: seg.width,
    elevation: roadElev,
    surface,
    tangentX: seg.dx * invLen,
    tangentZ: seg.dz * invLen,
  };
}

/**
 * Graded world terrain height that seamlessly matches road surfaces and skidpad.
 */
export function groundHeightAt(x: number, z: number): number {
  const raw = rawTerrainHeightAt(x, z);
  const info = getRoadInfoAt(x, z);
  const halfW = info.roadWidth * 0.5;
  const blendWidth = 11.0;

  let h = raw;
  if (info.distance <= halfW) {
    h = info.elevation;
  } else if (info.distance < halfW + blendWidth) {
    const t = (info.distance - halfW) / blendWidth;
    const smooth = t * t * (3 - 2 * t);
    h = info.elevation + (raw - info.elevation) * smooth;
  }

  // Smooth flat pad for Proving Ground
  const padDist = Math.hypot(x - PROVING_PAD.x, z - PROVING_PAD.z);
  if (padDist < PROVING_PAD.radius + 8) {
    const padBase = 0.35;
    if (padDist <= PROVING_PAD.radius) {
      h = Math.max(h, padBase);
      h = h * 0.15 + padBase * 0.85;
    } else {
      const pt = (padDist - PROVING_PAD.radius) / 8;
      const ps = pt * pt * (3 - 2 * pt);
      h = padBase + (h - padBase) * ps;
    }
  }

  return h;
}

export function getZoneNameAt(x: number, z: number): string {
  if (Math.hypot(x - PROVING_PAD.x, z - PROVING_PAD.z) < 55) {
    return 'Proving Ground Skidpad';
  }
  if (x < -80 && z > 20) return 'Harbor Pier & Bay';
  if (x < -45 && z < -25) return 'Downtown Skyline';
  if (x > 95 && z < -60) return 'Observatory Ridge';
  if (x > 80 && z > 75) return 'Canyon Switchbacks';
  if (Math.abs(x) < 60 && z > 85) return 'Coastal Grand Blvd';
  return 'Crestline Valley';
}

export const LANDMARKS: LandmarkInfo[] = [
  { id: 'downtown', name: 'Downtown Skyline', x: -108, z: -78, shortLabel: 'DTN' },
  { id: 'harbor', name: 'Harbor Pier', x: -176, z: 98, shortLabel: 'HBR' },
  { id: 'observatory', name: 'Observatory Summit', x: 192, z: -168, shortLabel: 'OBS' },
  { id: 'proving', name: 'Proving Ground', x: 112, z: 62, shortLabel: 'PG' },
];

// Deterministic buildings in Downtown & Harbor districts (well clear of roads)
export const BUILDINGS: WorldBuildingSpec[] = [
  // Downtown cluster (North-West inner block)
  { id: 'b1', x: -96, z: -68, width: 18, depth: 18, height: 34, rotationY: 0.08, style: 'glass' },
  { id: 'b2', x: -118, z: -88, width: 16, depth: 14, height: 46, rotationY: -0.05, style: 'glass' },
  { id: 'b3', x: -72, z: -92, width: 20, depth: 16, height: 26, rotationY: 0.12, style: 'concrete' },
  { id: 'b4', x: -116, z: -52, width: 15, depth: 15, height: 22, rotationY: 0.0, style: 'brick' },
  { id: 'b5', x: -58, z: -56, width: 16, depth: 14, height: 19, rotationY: -0.1, style: 'concrete' },
  { id: 'b6', x: -178, z: -96, width: 20, depth: 18, height: 30, rotationY: 0.2, style: 'glass' },
  { id: 'b7', x: -178, z: -48, width: 16, depth: 22, height: 20, rotationY: 0.05, style: 'concrete' },
  // Harbor warehouses
  { id: 'h1', x: -124, z: 68, width: 22, depth: 14, height: 9, rotationY: 0.15, style: 'warehouse' },
  { id: 'h2', x: -128, z: 24, width: 18, depth: 12, height: 8, rotationY: -0.1, style: 'warehouse' },
  // Central Service Plaza buildings
  { id: 'c1', x: -24, z: 42, width: 18, depth: 12, height: 8.5, rotationY: 0.0, style: 'concrete' },
  { id: 'c2', x: 34, z: -38, width: 16, depth: 14, height: 11, rotationY: 0.1, style: 'glass' },
];

// Deterministic PRNG for trees & rocks so physics colliders match rendered meshes 1:1
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PropPlacement {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotationY: number;
  tint: number;
}

export const TREE_PLACEMENTS: PropPlacement[] = [];
export const ROCK_PLACEMENTS: PropPlacement[] = [];

(() => {
  const rng = mulberry32(20261116);

  // Place 110 pine trees in groves away from roads, buildings, pad, and water
  let attempts = 0;
  while (TREE_PLACEMENTS.length < 110 && attempts < 1400) {
    attempts++;
    const x = (rng() - 0.5) * 410;
    const z = (rng() - 0.5) * 410;
    const info = getRoadInfoAt(x, z);
    if (info.distance < info.roadWidth * 0.5 + 7.5) continue;
    if (Math.hypot(x - PROVING_PAD.x, z - PROVING_PAD.z) < PROVING_PAD.radius + 7) continue;
    const y = groundHeightAt(x, z);
    if (y < 0.25) continue; // Keep out of bay/sand

    // Keep clear of buildings
    let nearBldg = false;
    for (const b of BUILDINGS) {
      if (Math.hypot(x - b.x, z - b.z) < Math.max(b.width, b.depth) * 0.75 + 6) {
        nearBldg = true;
        break;
      }
    }
    if (nearBldg) continue;

    TREE_PLACEMENTS.push({
      x,
      z,
      y,
      scale: 0.85 + rng() * 0.45,
      rotationY: rng() * Math.PI * 2,
      tint: rng(),
    });
  }

  // Place 48 canyon/coastal boulders
  attempts = 0;
  while (ROCK_PLACEMENTS.length < 48 && attempts < 800) {
    attempts++;
    const x = (rng() - 0.5) * 410;
    const z = (rng() - 0.5) * 410;
    const info = getRoadInfoAt(x, z);
    if (info.distance < info.roadWidth * 0.5 + 6.5) continue;
    if (Math.hypot(x - PROVING_PAD.x, z - PROVING_PAD.z) < PROVING_PAD.radius + 6) continue;
    const y = groundHeightAt(x, z);
    if (y < -0.2) continue;

    let nearBldg = false;
    for (const b of BUILDINGS) {
      if (Math.hypot(x - b.x, z - b.z) < Math.max(b.width, b.depth) * 0.75 + 5) {
        nearBldg = true;
        break;
      }
    }
    if (nearBldg) continue;

    ROCK_PLACEMENTS.push({
      x,
      z,
      y,
      scale: 0.8 + rng() * 1.1,
      rotationY: rng() * Math.PI * 2,
      tint: rng(),
    });
  }
})();

export const WORLD_COLLIDERS: WorldCollider[] = [
  ...BUILDINGS.map((b) => ({
    id: b.id,
    x: b.x,
    z: b.z,
    radius: Math.max(b.width, b.depth) * 0.52,
    height: b.height,
    kind: 'building' as const,
  })),
  // Lighthouse on Harbor point
  {
    id: 'lighthouse',
    x: -205,
    z: 108,
    radius: 4.5,
    height: 28,
    kind: 'lighthouse',
  },
  // Observatory Dome at summit
  {
    id: 'observatory-dome',
    x: 208,
    z: -180,
    radius: 9.0,
    height: 16,
    kind: 'tower',
  },
  // Industrial Silos near Proving Ground
  { id: 'silo-1', x: 162, z: 96, radius: 4.2, height: 16, kind: 'silo' },
  { id: 'silo-2', x: 174, z: 92, radius: 4.2, height: 16, kind: 'silo' },
  // Tree trunks
  ...TREE_PLACEMENTS.map((t, idx) => ({
    id: `tree-${idx}`,
    x: t.x,
    z: t.z,
    radius: 0.9 * t.scale,
    height: 7 * t.scale,
    kind: 'tree' as const,
  })),
  // Rocks
  ...ROCK_PLACEMENTS.map((r, idx) => ({
    id: `rock-${idx}`,
    x: r.x,
    z: r.z,
    radius: 1.5 * r.scale,
    height: 2.0 * r.scale,
    kind: 'rock' as const,
  })),
];

export const INITIAL_SPAWN = {
  x: 0,
  z: 128,
  heading: Math.PI / 2, // Facing +X along the straight Southern Coastal Grand Boulevard
};
