import {
  getRoadInfoAt,
  groundHeightAt,
  INITIAL_SPAWN,
  SEA_LEVEL,
  SurfaceType,
  WORLD_COLLIDERS,
  WORLD_HALF_EXTENT,
} from './worldData';

export type TransmissionMode = 'auto' | 'manual';

export interface VehicleControls {
  throttle: number;  // 0..1
  brake: number;     // 0..1
  steer: number;     // -1 (right) .. +1 (left)
  handbrake: boolean;
}

export interface VehicleSpec {
  mass: number;
  wheelbase: number;
  trackWidth: number;
  cgHeight: number;
  wheelRadius: number;
  dragArea: number;       // Cd * A
  rollingCoeff: number;
  maxSteerAngle: number;  // radians
  idleRpm: number;
  redlineRpm: number;
  finalDrive: number;
  gearRatios: Record<number, number>; // -1=R, 0=N, 1..6
  maxBrakeForce: number;
}

export const SPORTS_COUPE_SPEC: VehicleSpec = {
  mass: 1380,
  wheelbase: 2.72,
  trackWidth: 1.62,
  cgHeight: 0.48,
  wheelRadius: 0.34,
  dragArea: 0.64,
  rollingCoeff: 0.014,
  maxSteerAngle: 0.56,
  idleRpm: 850,
  redlineRpm: 7400,
  finalDrive: 3.73,
  gearRatios: {
    [-1]: -3.15,
    0: 0,
    1: 3.48,
    2: 2.26,
    3: 1.58,
    4: 1.18,
    5: 0.94,
    6: 0.78,
  },
  maxBrakeForce: 16500,
};

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  heading: number;     // yaw in radians: 0 => +Z, +PI/2 => +X
  vx: number;          // world X velocity (m/s)
  vz: number;          // world Z velocity (m/s)
  vy: number;          // vertical velocity (m/s)
  yawRate: number;     // rad/s
  forwardSpeed: number; // local forward m/s (signed)
  lateralSpeed: number; // local right/left m/s
  speedKmh: number;
  rpm: number;
  gear: number;        // -1 (R), 0 (N), 1..6
  transmission: TransmissionMode;
  steerAngle: number;
  wheelSpin: number;   // cumulative wheel rotation rad
  pitch: number;       // chassis longitudinal squat/dive rad
  roll: number;        // chassis lateral roll rad
  slipAngleDeg: number;
  rearSlipRatio: number; // 0..1+ for smoke & drift detection
  surface: SurfaceType;
  brakingLights: boolean;
  reverseLights: boolean;
  damage: number;      // 0..100
  lastImpactSpeed: number;
  shiftCooldown: number;
  revLimiterHit: boolean;
}

/**
 * Realistic naturally-aspirated / twin-scroll V6 torque curve (Nm).
 */
export function evaluateEngineTorque(rpm: number): number {
  const clamped = Math.max(800, Math.min(7600, rpm));
  if (clamped >= 7400) return 0; // Fuel cut rev limiter
  // Smooth bell-shaped automotive torque curve peaking around 5200 RPM (~445 Nm)
  const norm = (clamped - 4900) / 3600;
  const torque = 445 - 175 * norm * norm;
  if (clamped < 1500) {
    return torque * (0.72 + 0.28 * ((clamped - 800) / 700));
  }
  return Math.max(160, torque);
}

export function formatGearLabel(gear: number): string {
  if (gear === -1) return 'R';
  if (gear === 0) return 'N';
  return String(gear);
}

export function createInitialVehicleState(
  transmission: TransmissionMode = 'auto',
  x = INITIAL_SPAWN.x,
  z = INITIAL_SPAWN.z,
  heading = INITIAL_SPAWN.heading,
): VehicleState {
  const y = groundHeightAt(x, z);
  const info = getRoadInfoAt(x, z);
  return {
    x,
    y,
    z,
    heading,
    vx: 0,
    vz: 0,
    vy: 0,
    yawRate: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    speedKmh: 0,
    rpm: SPORTS_COUPE_SPEC.idleRpm,
    gear: transmission === 'auto' ? 1 : 1,
    transmission,
    steerAngle: 0,
    wheelSpin: 0,
    pitch: 0,
    roll: 0,
    slipAngleDeg: 0,
    rearSlipRatio: 0,
    surface: info.surface,
    brakingLights: false,
    reverseLights: false,
    damage: 0,
    lastImpactSpeed: 0,
    shiftCooldown: 0,
    revLimiterHit: false,
  };
}

export function shiftGearUp(state: VehicleState): VehicleState {
  if (state.gear >= 6) return state;
  const nextGear = state.gear + 1;
  return {
    ...state,
    gear: nextGear,
    shiftCooldown: 0.14,
  };
}

export function shiftGearDown(state: VehicleState): VehicleState {
  if (state.gear <= -1) return state;
  const nextGear = state.gear - 1;
  return {
    ...state,
    gear: nextGear,
    shiftCooldown: 0.14,
  };
}

function getSurfaceGripMultiplier(surface: SurfaceType): number {
  switch (surface) {
    case 'asphalt':
      return 1.12;
    case 'pad':
      return 1.04;
    case 'shoulder':
      return 0.84;
    case 'grass':
      return 0.72;
    case 'sand':
      return 0.56;
  }
}

function getSurfaceDragMultiplier(surface: SurfaceType): number {
  switch (surface) {
    case 'asphalt':
    case 'pad':
      return 1.0;
    case 'shoulder':
      return 1.7;
    case 'grass':
      return 2.8;
    case 'sand':
      return 4.2;
  }
}

export interface StepResult {
  impactIntensity: number; // 0 if no collision, >0 on collision
  gearChanged: boolean;
}

/**
 * Advances realistic car physics in-place (or cleanly on a state object) by dt seconds.
 * Decoupled from Three.js and DOM for deterministic unit testing.
 */
export function stepVehiclePhysics(
  state: VehicleState,
  controls: VehicleControls,
  dt: number,
  spec: VehicleSpec = SPORTS_COUPE_SPEC,
): StepResult {
  const safeDt = Math.min(0.04, Math.max(0.0005, dt));
  const prevGear = state.gear;

  if (state.shiftCooldown > 0) {
    state.shiftCooldown = Math.max(0, state.shiftCooldown - safeDt);
  }
  state.lastImpactSpeed = 0;

  // Forward and Right unit vectors in XZ plane
  // heading = 0 -> forward = (0, 1), right = (-1, 0)
  const sinH = Math.sin(state.heading);
  const cosH = Math.cos(state.heading);
  const fwdX = sinH;
  const fwdZ = cosH;
  const rightX = -cosH;
  const rightZ = sinH;

  // Transform world velocity into car local frame
  const vForward = state.vx * fwdX + state.vz * fwdZ;
  const vLateral = state.vx * rightX + state.vz * rightZ;
  const speedAbs = Math.hypot(vForward, vLateral);

  // Road & terrain info under car
  const roadInfo = getRoadInfoAt(state.x, state.z);
  state.surface = roadInfo.surface;
  const muSurface = getSurfaceGripMultiplier(roadInfo.surface);
  const dragSurface = getSurfaceDragMultiplier(roadInfo.surface);

  // Automatic transmission logic (smart hysteresis + reverse engagement)
  let effectiveThrottle = controls.throttle;
  let effectiveBrake = controls.brake;

  if (state.transmission === 'auto') {
    // If stopped or creeping backward and holding brake without throttle, shift into Reverse
    if (state.gear >= 1 && vForward < 0.8 && controls.brake > 0.25 && controls.throttle < 0.05) {
      state.gear = -1;
      state.shiftCooldown = 0.2;
    } else if (state.gear === -1) {
      // In Reverse, holding brake becomes reverse throttle, holding throttle shifts back to 1
      if (controls.throttle > 0.2) {
        if (vForward > -1.0) {
          state.gear = 1;
          state.shiftCooldown = 0.2;
        } else {
          effectiveBrake = controls.throttle;
          effectiveThrottle = 0;
        }
      } else {
        effectiveThrottle = controls.brake;
        effectiveBrake = 0;
      }
    } else if (state.gear === 0) {
      if (controls.throttle > 0.1) state.gear = 1;
    } else if (state.shiftCooldown <= 0) {
      // Upshift / downshift points based on RPM & throttle
      const upshiftRpm = 6200 + controls.throttle * 750;
      const downshiftRpm = 2400 + controls.throttle * 950;
      if (state.rpm > upshiftRpm && state.gear < 6 && vForward > 3) {
        state.gear += 1;
        state.shiftCooldown = 0.28;
      } else if (state.rpm < downshiftRpm && state.gear > 1) {
        state.gear -= 1;
        state.shiftCooldown = 0.28;
      }
    }
  } else {
    // Manual mode: brake slows car whether in 1..6 or R
    if (state.gear === -1) {
      // In manual reverse, throttle drives backward, brake slows down
      effectiveThrottle = controls.throttle;
      effectiveBrake = controls.brake;
    }
  }

  // Smooth speed-sensitive steering angle
  const speedSteerFactor = 1 / (1 + (speedAbs * speedAbs) * 0.0022);
  const targetSteer = controls.steer * spec.maxSteerAngle * Math.max(0.28, speedSteerFactor);
  const steerRate = 6.5;
  state.steerAngle += (targetSteer - state.steerAngle) * Math.min(1, steerRate * safeDt);

  // Wheel RPM from vehicle forward speed
  const gearRatio = spec.gearRatios[state.gear] ?? 0;
  const wheelAngularVel = vForward / spec.wheelRadius; // rad/s
  const wheelRpm = (wheelAngularVel * 60) / (2 * Math.PI);

  let targetRpm = spec.idleRpm;
  if (state.gear === 0) {
    // Neutral: free revving
    targetRpm = spec.idleRpm + effectiveThrottle * (spec.redlineRpm - spec.idleRpm);
    state.rpm += (targetRpm - state.rpm) * Math.min(1, 7.5 * safeDt);
  } else {
    const drivetrainRpm = Math.abs(wheelRpm * gearRatio * spec.finalDrive);
    // Clutch slip at low speed / launch
    const launchBlend = Math.min(1, Math.abs(vForward) / 5.5);
    const stallRev = spec.idleRpm + effectiveThrottle * 2400;
    targetRpm = Math.max(spec.idleRpm * 0.75, drivetrainRpm * launchBlend + stallRev * (1 - launchBlend));
    state.rpm += (targetRpm - state.rpm) * Math.min(1, 14 * safeDt);
  }

  // Rev limiter bounce
  state.revLimiterHit = state.rpm >= spec.redlineRpm - 50;
  if (state.rpm > spec.redlineRpm + 120) {
    state.rpm = spec.redlineRpm - 180;
  }

  // Longitudinal forces
  let driveForce = 0;
  if (state.gear !== 0 && state.shiftCooldown <= 0.04) {
    const engineTorque = evaluateEngineTorque(state.rpm);
    // Clutch efficiency dips slightly in manual if bogging below 1100 rpm in high gear
    const bogFactor =
      state.transmission === 'manual' && state.gear >= 3 && state.rpm < 1250 ? 0.55 : 1.0;
    const wheelTorque = engineTorque * gearRatio * spec.finalDrive * 0.88 * bogFactor;
    driveForce = (wheelTorque / spec.wheelRadius) * effectiveThrottle;

    // Engine braking when off throttle in gear
    if (effectiveThrottle < 0.05 && Math.abs(vForward) > 1.2) {
      const signDir = state.gear > 0 ? 1 : -1;
      driveForce -= signDir * Math.abs(gearRatio) * 280;
    }
  }

  // Braking & Handbrake longitudinal resistance
  let brakeForce = 0;
  const totalBrakeInput = Math.max(effectiveBrake, controls.handbrake ? 0.55 : 0);
  if (totalBrakeInput > 0.01 && Math.abs(vForward) > 0.05) {
    brakeForce = -Math.sign(vForward) * spec.maxBrakeForce * totalBrakeInput;
  }

  // Aerodynamic drag & rolling resistance
  const aeroDrag = -0.5 * 1.225 * spec.dragArea * vForward * Math.abs(vForward);
  const rollingRes = -spec.rollingCoeff * dragSurface * spec.mass * 9.81 * (Math.abs(vForward) > 0.1 ? Math.sign(vForward) : 0);

  // Terrain slope gravity force along car forward axis
  const sampleAhead = groundHeightAt(state.x + fwdX * 1.2, state.z + fwdZ * 1.2);
  const sampleBehind = groundHeightAt(state.x - fwdX * 1.2, state.z - fwdZ * 1.2);
  const slopeSin = Math.max(-0.45, Math.min(0.45, (sampleAhead - sampleBehind) / 2.4));
  const gravitySlopeForce = -spec.mass * 9.81 * slopeSin;

  // Dynamic axle normal loads (longitudinal weight transfer)
  const staticFrontLoad = spec.mass * 9.81 * 0.52;
  const staticRearLoad = spec.mass * 9.81 * 0.48;
  const prevAx = Math.max(-12, Math.min(12, (driveForce + brakeForce) / spec.mass));
  const weightTransferLong = (prevAx * spec.mass * spec.cgHeight) / spec.wheelbase;
  const frontLoad = Math.max(1500, staticFrontLoad - weightTransferLong);
  const rearLoad = Math.max(1500, staticRearLoad + weightTransferLong);

  // Cap longitudinal drive force by available rear-wheel traction (RWD sports coupe)
  const maxDriveTraction = rearLoad * muSurface * 1.15;
  const clampedDriveForce = Math.max(-maxDriveTraction, Math.min(maxDriveTraction, driveForce));

  const totalLongForce = clampedDriveForce + brakeForce + aeroDrag + rollingRes + gravitySlopeForce;
  const ax = totalLongForce / spec.mass;

  // Bicycle model lateral dynamics (slip angles at front & rear axles)
  const halfWb = spec.wheelbase * 0.5;
  let latForceFront = 0;
  let latForceRear = 0;
  let lateralAccel = 0;

  if (speedAbs > 0.4) {
    const absVf = Math.max(0.8, Math.abs(vForward));
    const frontLatVel = vLateral + state.yawRate * halfWb;
    const rearLatVel = vLateral - state.yawRate * halfWb;

    // Velocity-dependent slip angle (positive steer turns left, so subtract steerAngle when moving forward)
    const dirSign = vForward >= 0 ? 1 : -1;
    const alphaFront = Math.atan2(frontLatVel, absVf) - state.steerAngle * dirSign;
    const alphaRear = Math.atan2(rearLatVel, absVf);

    // Smooth Pacejka-like lateral tire curve
    const corneringStiffnessFront = 6.2;
    const corneringStiffnessRear = controls.handbrake ? 1.8 : 6.6;
    const rearGripScale = controls.handbrake ? 0.34 : 1.0;

    latForceFront = -frontLoad * muSurface * 1.18 * Math.tanh(corneringStiffnessFront * alphaFront);
    latForceRear = -rearLoad * muSurface * 1.18 * rearGripScale * Math.tanh(corneringStiffnessRear * alphaRear);

    state.slipAngleDeg = Math.abs((alphaRear * 180) / Math.PI);
    state.rearSlipRatio = Math.min(1.5, Math.abs(alphaRear) * 2.2 + (controls.handbrake && speedAbs > 6 ? 0.6 : 0));
  } else {
    state.slipAngleDeg = 0;
    state.rearSlipRatio = 0;
  }

  const totalLatForce = latForceFront + latForceRear;
  lateralAccel = totalLatForce / spec.mass;

  // Yaw torque around vertical axis
  const yawInertia = spec.mass * 1.95;
  const yawTorque = latForceFront * halfWb - latForceRear * halfWb;
  const yawAccel = yawTorque / yawInertia;

  // Integrate local velocities + centripetal coupling
  let nextVf = vForward + (ax + vLateral * state.yawRate) * safeDt;
  let nextVl = vLateral + (lateralAccel - vForward * state.yawRate) * safeDt;
  let nextYawRate = state.yawRate + yawAccel * safeDt;

  // Strong low-speed damping so car comes to a crisp halt without jitter
  if (Math.abs(nextVf) < 0.25 && effectiveThrottle < 0.05 && (totalBrakeInput > 0.05 || Math.abs(slopeSin) < 0.04)) {
    nextVf = 0;
    nextVl *= 0.6;
    nextYawRate *= 0.6;
  } else {
    // Subtle natural tire alignment damping at low speed
    const lowSpeedDamp = speedAbs < 3 ? 0.88 : 0.992;
    nextVl *= lowSpeedDamp;
    nextYawRate *= speedAbs < 3 ? 0.85 : 0.99;
  }

  // Clamp extreme rotational velocity
  nextYawRate = Math.max(-4.0, Math.min(4.0, nextYawRate));

  // Integrate heading & world velocities
  state.heading += nextYawRate * safeDt;
  const nSin = Math.sin(state.heading);
  const nCos = Math.cos(state.heading);
  state.vx = nSin * nextVf - nCos * nextVl;
  state.vz = nCos * nextVf + nSin * nextVl;

  state.x += state.vx * safeDt;
  state.z += state.vz * safeDt;

  // Collision detection & impulse response with world colliders
  let maxImpact = 0;
  const carRadius = 1.65;
  for (let i = 0; i < WORLD_COLLIDERS.length; i++) {
    const col = WORLD_COLLIDERS[i];
    const dx = state.x - col.x;
    const dz = state.z - col.z;
    const minSep = carRadius + col.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq < minSep * minSep && distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minSep - dist;
      state.x += nx * overlap;
      state.z += nz * overlap;

      const vn = state.vx * nx + state.vz * nz;
      if (vn < 0) {
        const impact = -vn;
        if (impact > maxImpact) maxImpact = impact;
        const restitution = 0.25;
        state.vx -= (1 + restitution) * vn * nx;
        state.vz -= (1 + restitution) * vn * nz;
        // Friction along wall tangent
        state.vx *= 0.88;
        state.vz *= 0.88;
      }
    }
  }

  // Outer world boundary & ocean guard
  const maxBound = WORLD_HALF_EXTENT - 10;
  if (state.x < -maxBound || state.x > maxBound) {
    const clampedX = Math.max(-maxBound, Math.min(maxBound, state.x));
    maxImpact = Math.max(maxImpact, Math.abs(state.vx) * 0.5);
    state.x = clampedX;
    state.vx *= -0.35;
  }
  if (state.z < -maxBound || state.z > maxBound) {
    const clampedZ = Math.max(-maxBound, Math.min(maxBound, state.z));
    maxImpact = Math.max(maxImpact, Math.abs(state.vz) * 0.5);
    state.z = clampedZ;
    state.vz *= -0.35;
  }

  // Prevent driving deep into coastal ocean water
  const targetGroundY = groundHeightAt(state.x, state.z);
  if (targetGroundY < SEA_LEVEL + 0.15) {
    // Push softly back toward shore
    state.x -= state.vx * safeDt * 1.4;
    state.z -= state.vz * safeDt * 1.4;
    state.vx *= 0.4;
    state.vz *= 0.4;
  }

  // Smooth ground height tracking
  const newGroundY = groundHeightAt(state.x, state.z);
  state.y += (newGroundY - state.y) * Math.min(1, 18 * safeDt);

  // Damage accumulation on meaningful collisions (> 5 m/s ~ 18 km/h)
  if (maxImpact > 5.0) {
    const dmgDelta = Math.min(28, (maxImpact - 4.0) * 1.25);
    state.damage = Math.min(100, state.damage + dmgDelta);
    state.lastImpactSpeed = maxImpact;
  }

  // Re-project final local speeds & HUD values
  state.forwardSpeed = state.vx * nSin + state.vz * nCos;
  state.lateralSpeed = -state.vx * nCos + state.vz * nSin;
  state.yawRate = nextYawRate;
  state.speedKmh = Math.hypot(state.vx, state.vz) * 3.6;
  state.wheelSpin += (state.forwardSpeed / spec.wheelRadius) * safeDt;

  // Chassis suspension squat/dive pitch and lateral roll
  const targetPitch = Math.max(-0.045, Math.min(0.045, -ax * 0.0042));
  const targetRoll = Math.max(-0.075, Math.min(0.075, lateralAccel * 0.0065));
  state.pitch += (targetPitch - state.pitch) * Math.min(1, 10 * safeDt);
  state.roll += (targetRoll - state.roll) * Math.min(1, 10 * safeDt);

  state.brakingLights = controls.brake > 0.1 || controls.handbrake;
  state.reverseLights = state.gear === -1;

  return {
    impactIntensity: maxImpact,
    gearChanged: state.gear !== prevGear,
  };
}
