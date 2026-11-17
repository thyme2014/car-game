import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialVehicleState,
  evaluateEngineTorque,
  formatGearLabel,
  shiftGearDown,
  shiftGearUp,
  stepVehiclePhysics,
} from './vehiclePhysics';
import {
  createFreeroamState,
  MISSIONS,
  startMissionState,
  stepMissionProgress,
} from './missions';
import { getRoadInfoAt, groundHeightAt, INITIAL_SPAWN } from './worldData';

test('spawn point sits squarely on asphalt road surface', () => {
  const info = getRoadInfoAt(INITIAL_SPAWN.x, INITIAL_SPAWN.z);
  assert.equal(info.surface, 'asphalt');
  assert.ok(info.distance < 1.0, `Expected spawn near road centerline, got ${info.distance}`);
  const groundY = groundHeightAt(INITIAL_SPAWN.x, INITIAL_SPAWN.z);
  assert.ok(Number.isFinite(groundY) && groundY >= 0);
});

test('engine torque curve peaks around mid-high RPM and cuts at redline', () => {
  const lowTorque = evaluateEngineTorque(1200);
  const peakTorque = evaluateEngineTorque(5000);
  const redlineCut = evaluateEngineTorque(7450);
  assert.ok(peakTorque > lowTorque, 'Peak torque should exceed low RPM torque');
  assert.equal(redlineCut, 0, 'Fuel cut should return 0 torque above redline');
});

test('automatic transmission accelerates and upshifts through gears', () => {
  const car = createInitialVehicleState('auto');
  assert.equal(car.gear, 1);

  for (let i = 0; i < 260; i++) {
    stepVehiclePhysics(car, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60);
  }

  assert.ok(car.speedKmh > 65, `Expected car speed > 65 km/h after throttle, got ${car.speedKmh}`);
  assert.ok(car.gear >= 2, `Expected auto transmission to upshift from 1st, got gear ${car.gear}`);
});

test('manual transmission holds selected gear and responds to explicit shifts', () => {
  let car = createInitialVehicleState('manual');
  assert.equal(car.gear, 1);

  for (let i = 0; i < 180; i++) {
    stepVehiclePhysics(car, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60);
  }

  // Should remain in 1st gear in manual mode even at high RPM
  assert.equal(car.gear, 1);
  assert.ok(car.rpm > 6500, `Expected high RPM in 1st gear, got ${car.rpm}`);

  // Shift up manually 1 -> 2
  car = shiftGearUp(car);
  assert.equal(car.gear, 2);
  assert.equal(formatGearLabel(car.gear), '2');

  // Step a few frames; RPM should settle lower in 2nd gear
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(car, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60);
  }
  assert.equal(car.gear, 2);

  // Shift down 2 -> 1 -> N -> R
  car = shiftGearDown(car);
  assert.equal(car.gear, 1);
  car = shiftGearDown(car);
  assert.equal(car.gear, 0);
  assert.equal(formatGearLabel(car.gear), 'N');
  car = shiftGearDown(car);
  assert.equal(car.gear, -1);
  assert.equal(formatGearLabel(car.gear), 'R');
});

test('steering turns vehicle heading smoothly when moving', () => {
  const car = createInitialVehicleState('auto');
  const startHeading = car.heading;

  // Accelerate while steering left (+1)
  for (let i = 0; i < 120; i++) {
    stepVehiclePhysics(car, { throttle: 0.9, brake: 0, steer: 0.8, handbrake: false }, 1 / 60);
  }

  assert.ok(Math.abs(car.heading - startHeading) > 0.25, 'Vehicle heading should turn significantly');
});

test('mission checkpoints progress and complete mission cleanly', () => {
  const mission = MISSIONS[0];
  const state = startMissionState(mission.id);
  assert.equal(state.status, 'active');
  assert.equal(state.checkpointIndex, 0);

  for (let i = 0; i < mission.checkpoints.length; i++) {
    const cp = mission.checkpoints[i];
    const evt = stepMissionProgress(
      state,
      { x: cp.x, z: cp.z, speedKmh: 110, slipAngleDeg: 5, damage: 0 },
      0.5,
    );
    assert.equal(evt.checkpointCleared, true);
    if (i < mission.checkpoints.length - 1) {
      assert.equal(state.status, 'active');
    } else {
      assert.equal(evt.missionFinished, 'completed');
      assert.equal(state.status, 'completed');
    }
  }
});

test('delivery mission fails when damage exceeds threshold', () => {
  const delivery = MISSIONS.find((m) => m.kind === 'delivery')!;
  const state = startMissionState(delivery.id);
  const evt = stepMissionProgress(
    state,
    { x: delivery.startX, z: delivery.startZ, speedKmh: 30, slipAngleDeg: 0, damage: 55 },
    0.1,
  );
  assert.equal(evt.missionFinished, 'failed');
  assert.equal(state.status, 'failed');

  const freeroam = createFreeroamState();
  assert.equal(freeroam.status, 'freeroam');
});
