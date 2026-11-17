import { TransmissionMode } from './vehiclePhysics';
import { SurfaceType } from './worldData';

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';
export type CameraMode = 'chase' | 'hood' | 'far';

export interface HudTelemetry {
  speedKmh: number;
  rpm: number;
  gear: number;
  transmission: TransmissionMode;
  surface: SurfaceType;
  damage: number;
  revLimiterHit: boolean;
  braking: boolean;
  handbrake: boolean;
  x: number;
  z: number;
  heading: number;
  zoneName: string;
  cameraMode: CameraMode;
  // Mission / Freeroam stats
  activeMissionId: string | null;
  missionStatus: 'freeroam' | 'active' | 'completed' | 'failed';
  failReason: string | null;
  elapsedSec: number;
  remainingSec: number;
  checkpointIndex: number;
  checkpointCount: number;
  nextCheckpointX: number | null;
  nextCheckpointZ: number | null;
  nextCheckpointLabel: string | null;
  driftScore: number;
  topSpeedKmh: number;
  distanceMeters: number;
  completionTimeSec: number | null;
}

export interface DrivingBridge {
  setTransmission: (mode: TransmissionMode) => void;
  shiftUp: () => void;
  shiftDown: () => void;
  cycleCamera: () => void;
  resetCar: () => void;
  startFreeroam: () => void;
  startMission: (missionId: string) => void;
  setTouchControl: (key: 'throttle' | 'brake' | 'left' | 'right' | 'handbrake', active: boolean) => void;
}
