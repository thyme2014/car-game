export type MissionKind = 'time-trial' | 'delivery' | 'drift-apex';

export interface MissionCheckpoint {
  x: number;
  z: number;
  radius: number;
  label: string;
}

export interface MissionDefinition {
  id: string;
  title: string;
  subtitle: string;
  kind: MissionKind;
  timeLimitSec: number;
  startX: number;
  startZ: number;
  startHeading: number;
  checkpoints: MissionCheckpoint[];
  targetDriftScore?: number;
  maxAllowedDamage?: number; // e.g., 50% max damage for cargo delivery
}

export interface MissionRuntimeState {
  activeMissionId: string | null; // null = Freeroam
  status: 'freeroam' | 'active' | 'completed' | 'failed';
  failReason: string | null;
  elapsedSec: number;
  remainingSec: number;
  checkpointIndex: number;
  driftScore: number;
  topSpeedKmh: number;
  distanceMeters: number;
  lastCheckpointAt: number;
  completionTimeSec: number | null;
}

export const MISSIONS: MissionDefinition[] = [
  {
    id: 'canyon-time-trial',
    title: 'Coastal Canyon Time Trial',
    subtitle: 'Clear 8 high-speed highway checkpoints across the valley loop.',
    kind: 'time-trial',
    timeLimitSec: 95,
    startX: 0,
    startZ: 128,
    startHeading: Math.PI / 2,
    checkpoints: [
      { x: 118, z: 118, radius: 11, label: 'East Canyon Entry' },
      { x: 158, z: 48, radius: 11, label: 'Proving Straight' },
      { x: 146, z: -46, radius: 11, label: 'Foothill Sweep' },
      { x: 116, z: -124, radius: 11, label: 'Ridge Apex' },
      { x: 24, z: -148, radius: 11, label: 'North Valley Straight' },
      { x: -86, z: -135, radius: 11, label: 'Overpass Approach' },
      { x: -148, z: -60, radius: 11, label: 'Downtown Avenue' },
      { x: -120, z: 118, radius: 12, label: 'Coastal Finish Gate' },
    ],
  },
  {
    id: 'observatory-delivery',
    title: 'Observatory Express Delivery',
    subtitle: 'Transport telemetry equipment from Harbor Pier to the Observatory Summit under 50% damage.',
    kind: 'delivery',
    timeLimitSec: 90,
    startX: -175,
    startZ: 94,
    startHeading: 0.45,
    maxAllowedDamage: 50,
    checkpoints: [
      { x: -155, z: 38, radius: 11, label: 'Harbor Exit' },
      { x: -72, z: -15, radius: 11, label: 'Cross-Valley Blvd' },
      { x: 0, z: 0, radius: 11, label: 'Central Plaza' },
      { x: 148, z: -45, radius: 11, label: 'Foothill Junction' },
      { x: 156, z: -146, radius: 11, label: 'Switchback Hairpin' },
      { x: 192, z: -168, radius: 13, label: 'Observatory Summit' },
    ],
  },
  {
    id: 'proving-drift-apex',
    title: 'Proving Ground Drift Apex',
    subtitle: 'Score 4,500 drift & speed points and clear the 4 proving ground gates.',
    kind: 'drift-apex',
    timeLimitSec: 85,
    startX: 78,
    startZ: 20,
    startHeading: Math.PI * 0.72,
    targetDriftScore: 4500,
    checkpoints: [
      { x: 112, z: 62, radius: 13, label: 'Skidpad North Entry' },
      { x: 132, z: 76, radius: 13, label: 'East Sweeper' },
      { x: 96, z: 82, radius: 13, label: 'South Hairpin' },
      { x: 112, z: 42, radius: 13, label: 'Finish Apex' },
    ],
  },
];

export function createFreeroamState(): MissionRuntimeState {
  return {
    activeMissionId: null,
    status: 'freeroam',
    failReason: null,
    elapsedSec: 0,
    remainingSec: 0,
    checkpointIndex: 0,
    driftScore: 0,
    topSpeedKmh: 0,
    distanceMeters: 0,
    lastCheckpointAt: 0,
    completionTimeSec: null,
  };
}

export function startMissionState(missionId: string): MissionRuntimeState {
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) return createFreeroamState();

  return {
    activeMissionId: mission.id,
    status: 'active',
    failReason: null,
    elapsedSec: 0,
    remainingSec: mission.timeLimitSec,
    checkpointIndex: 0,
    driftScore: 0,
    topSpeedKmh: 0,
    distanceMeters: 0,
    lastCheckpointAt: 0,
    completionTimeSec: null,
  };
}

export function getActiveMission(state: MissionRuntimeState): MissionDefinition | null {
  if (!state.activeMissionId) return null;
  return MISSIONS.find((m) => m.id === state.activeMissionId) ?? null;
}

export interface MissionStepEvents {
  checkpointCleared: boolean;
  missionFinished: 'completed' | 'failed' | null;
}

export function stepMissionProgress(
  missionState: MissionRuntimeState,
  vehicle: {
    x: number;
    z: number;
    speedKmh: number;
    slipAngleDeg: number;
    damage: number;
  },
  dt: number,
): MissionStepEvents {
  const events: MissionStepEvents = {
    checkpointCleared: false,
    missionFinished: null,
  };

  missionState.elapsedSec += dt;
  missionState.topSpeedKmh = Math.max(missionState.topSpeedKmh, vehicle.speedKmh);
  missionState.distanceMeters += (vehicle.speedKmh / 3.6) * dt;

  // Accumulate drift score whenever sliding cleanly above 28 km/h and > 11 deg slip
  if (vehicle.speedKmh > 28 && vehicle.slipAngleDeg > 11 && vehicle.slipAngleDeg < 78) {
    const rate = (vehicle.speedKmh * 2.4 + vehicle.slipAngleDeg * 12) * dt;
    missionState.driftScore += rate;
  }

  if (missionState.status !== 'active') {
    return events;
  }

  const mission = getActiveMission(missionState);
  if (!mission) return events;

  missionState.remainingSec = Math.max(0, missionState.remainingSec - dt);

  // Check damage constraint for delivery missions
  if (mission.maxAllowedDamage !== undefined && vehicle.damage >= mission.maxAllowedDamage) {
    missionState.status = 'failed';
    missionState.failReason = `Cargo integrity lost (${Math.round(vehicle.damage)}% chassis damage).`;
    events.missionFinished = 'failed';
    return events;
  }

  // Check timer expiry
  if (missionState.remainingSec <= 0) {
    missionState.status = 'failed';
    missionState.failReason = 'Time expired before reaching the objective.';
    events.missionFinished = 'failed';
    return events;
  }

  // Check current checkpoint collision
  const cp = mission.checkpoints[missionState.checkpointIndex];
  if (cp) {
    const dist = Math.hypot(vehicle.x - cp.x, vehicle.z - cp.z);
    if (dist <= cp.radius) {
      missionState.checkpointIndex += 1;
      missionState.lastCheckpointAt = missionState.elapsedSec;
      events.checkpointCleared = true;

      const allGatesCleared = missionState.checkpointIndex >= mission.checkpoints.length;
      if (allGatesCleared) {
        if (mission.kind === 'drift-apex' && mission.targetDriftScore) {
          if (missionState.driftScore >= mission.targetDriftScore) {
            missionState.status = 'completed';
            missionState.completionTimeSec = missionState.elapsedSec;
            events.missionFinished = 'completed';
          } else {
            // Loop back to gate 0 until target drift score is reached
            missionState.checkpointIndex = 0;
          }
        } else {
          missionState.status = 'completed';
          missionState.completionTimeSec = missionState.elapsedSec;
          events.missionFinished = 'completed';
        }
      }
    }
  }

  return events;
}
