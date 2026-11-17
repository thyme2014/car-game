import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  createInitialVehicleState,
  shiftGearDown,
  shiftGearUp,
  stepVehiclePhysics,
  TransmissionMode,
  VehicleControls,
  VehicleState,
} from '../game/vehiclePhysics';
import {
  createFreeroamState,
  getActiveMission,
  MISSIONS,
  MissionRuntimeState,
  startMissionState,
  stepMissionProgress,
} from '../game/missions';
import { getZoneNameAt, groundHeightAt, INITIAL_SPAWN } from '../game/worldData';
import { buildOpenWorldScene, spawnSmokePuff, stepSmokePool } from '../game/sceneBuilder';
import { ProceduralEngineAudio } from '../game/engineAudio';
import { CameraMode, DrivingBridge, GamePhase, HudTelemetry } from '../game/types';

interface DrivingCanvasProps {
  phase: GamePhase;
  muted: boolean;
  initialTransmission: TransmissionMode;
  onTelemetry: (telemetry: HudTelemetry) => void;
  onMissionOutcome: (status: 'completed' | 'failed', snapshot: HudTelemetry) => void;
  onToast: (message: string) => void;
  bridgeRef: React.MutableRefObject<DrivingBridge | null>;
}

// Pre-allocated scratch math objects (zero-GC in animation loop)
const _camDesired = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export const DrivingCanvas: React.FC<DrivingCanvasProps> = ({
  phase,
  muted,
  initialTransmission,
  onTelemetry,
  onMissionOutcome,
  onToast,
  bridgeRef,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  const mutedRef = useRef<boolean>(muted);
  const callbacksRef = useRef({ onTelemetry, onMissionOutcome, onToast });

  phaseRef.current = phase;
  mutedRef.current = muted;
  callbacksRef.current = { onTelemetry, onMissionOutcome, onToast };

  const audioRef = useRef<ProceduralEngineAudio | null>(null);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect software WebGL (SwiftShader/llvmpipe/WARP) strictly from renderer string
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param) || '');
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('data-testid', 'driving-canvas');

    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      62,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.3,
      900,
    );

    const world = buildOpenWorldScene(renderer, isSoftwareGl);
    if (!isSoftwareGl) {
      renderer.compile(world.scene, camera);
    }

    const audio = new ProceduralEngineAudio();
    audioRef.current = audio;

    // Mutable simulation state inside ref/closure
    let vehicle: VehicleState = createInitialVehicleState(initialTransmission);
    let missionState: MissionRuntimeState = createFreeroamState();
    let cameraMode: CameraMode = 'chase';
    let cameraTrauma = 0;
    let titleOrbitAngle = 0.65;
    let smokeAccum = 0;

    // Initialize camera behind car
    camera.position.set(vehicle.x - 8.5, vehicle.y + 3.4, vehicle.z - 2.0);
    camera.lookAt(vehicle.x + 6, vehicle.y + 1.0, vehicle.z);

    // Unified keyboard & touch input state
    const keysDown = new Set<string>();
    const touchInputs = {
      throttle: false,
      brake: false,
      left: false,
      right: false,
      handbrake: false,
    };

    const buildSnapshot = (): HudTelemetry => {
      const activeMission = getActiveMission(missionState);
      const cp = activeMission?.checkpoints[missionState.checkpointIndex] ?? null;
      return {
        speedKmh: vehicle.speedKmh,
        rpm: vehicle.rpm,
        gear: vehicle.gear,
        transmission: vehicle.transmission,
        surface: vehicle.surface,
        damage: vehicle.damage,
        revLimiterHit: vehicle.revLimiterHit,
        braking: vehicle.brakingLights,
        handbrake: touchInputs.handbrake || keysDown.has('Space'),
        x: vehicle.x,
        z: vehicle.z,
        heading: vehicle.heading,
        zoneName: getZoneNameAt(vehicle.x, vehicle.z),
        cameraMode,
        activeMissionId: missionState.activeMissionId,
        missionStatus: missionState.status,
        failReason: missionState.failReason,
        elapsedSec: missionState.elapsedSec,
        remainingSec: missionState.remainingSec,
        checkpointIndex: missionState.checkpointIndex,
        checkpointCount: activeMission ? activeMission.checkpoints.length : 0,
        nextCheckpointX: cp ? cp.x : null,
        nextCheckpointZ: cp ? cp.z : null,
        nextCheckpointLabel: cp ? cp.label : null,
        driftScore: missionState.driftScore,
        topSpeedKmh: missionState.topSpeedKmh,
        distanceMeters: missionState.distanceMeters,
        completionTimeSec: missionState.completionTimeSec,
      };
    };

    const doShiftUp = () => {
      audio.resume();
      const next = shiftGearUp(vehicle);
      if (next.gear !== vehicle.gear) {
        vehicle = next;
        audio.playShiftClunk();
        callbacksRef.current.onTelemetry(buildSnapshot());
      }
    };

    const doShiftDown = () => {
      audio.resume();
      const next = shiftGearDown(vehicle);
      if (next.gear !== vehicle.gear) {
        vehicle = next;
        audio.playShiftClunk();
        callbacksRef.current.onTelemetry(buildSnapshot());
      }
    };

    const setTransmission = (mode: TransmissionMode) => {
      vehicle.transmission = mode;
      if (mode === 'auto' && vehicle.gear === 0) vehicle.gear = 1;
      callbacksRef.current.onToast(`Transmission: ${mode === 'auto' ? 'Automatic' : 'Manual 6-Speed'}`);
      callbacksRef.current.onTelemetry(buildSnapshot());
    };

    const cycleCamera = () => {
      const order: CameraMode[] = ['chase', 'hood', 'far'];
      const nextIdx = (order.indexOf(cameraMode) + 1) % order.length;
      cameraMode = order[nextIdx];
      const labels: Record<CameraMode, string> = {
        chase: 'Chase Cam',
        hood: 'Hood Cam',
        far: 'Wide Pursuit Cam',
      };
      callbacksRef.current.onToast(`Camera: ${labels[cameraMode]}`);
      callbacksRef.current.onTelemetry(buildSnapshot());
    };

    const resetCarToRoad = (x = INITIAL_SPAWN.x, z = INITIAL_SPAWN.z, heading = INITIAL_SPAWN.heading) => {
      vehicle = createInitialVehicleState(vehicle.transmission, x, z, heading);
      // Snap chase camera cleanly behind car
      const sinH = Math.sin(vehicle.heading);
      const cosH = Math.cos(vehicle.heading);
      camera.position.set(vehicle.x - sinH * 8.2, vehicle.y + 3.2, vehicle.z - cosH * 8.2);
      camera.lookAt(vehicle.x + sinH * 4, vehicle.y + 1.0, vehicle.z + cosH * 4);
      callbacksRef.current.onTelemetry(buildSnapshot());
    };

    // Expose imperative bridge to React shell
    bridgeRef.current = {
      setTransmission,
      shiftUp: doShiftUp,
      shiftDown: doShiftDown,
      cycleCamera,
      resetCar: () => {
        if (missionState.activeMissionId) {
          const m = MISSIONS.find((item) => item.id === missionState.activeMissionId);
          if (m) {
            missionState = startMissionState(m.id);
            resetCarToRoad(m.startX, m.startZ, m.startHeading);
            return;
          }
        }
        resetCarToRoad(INITIAL_SPAWN.x, INITIAL_SPAWN.z, INITIAL_SPAWN.heading);
      },
      startFreeroam: () => {
        audio.resume();
        missionState = createFreeroamState();
        resetCarToRoad(INITIAL_SPAWN.x, INITIAL_SPAWN.z, INITIAL_SPAWN.heading);
      },
      startMission: (missionId: string) => {
        audio.resume();
        const m = MISSIONS.find((item) => item.id === missionId);
        if (!m) return;
        missionState = startMissionState(missionId);
        resetCarToRoad(m.startX, m.startZ, m.startHeading);
        callbacksRef.current.onToast(`Mission Started: ${m.title}`);
      },
      setTouchControl: (key, active) => {
        audio.resume();
        touchInputs[key] = active;
      },
    };

    // Keyboard listeners
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      keysDown.add(e.code);

      if (phaseRef.current !== 'playing') return;
      audio.resume();

      if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        doShiftUp();
      } else if (e.code === 'KeyQ' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
        doShiftDown();
      } else if (e.code === 'KeyM') {
        setTransmission(vehicle.transmission === 'auto' ? 'manual' : 'auto');
      } else if (e.code === 'KeyC') {
        cycleCamera();
      } else if (e.code === 'KeyR') {
        bridgeRef.current?.resetCar();
        callbacksRef.current.onToast('Vehicle Reset');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.code);
    };

    const clearHeldInputs = () => {
      keysDown.clear();
      touchInputs.throttle = false;
      touchInputs.brake = false;
      touchInputs.left = false;
      touchInputs.right = false;
      touchInputs.handbrake = false;
    };

    const onVisibilityChange = () => {
      if (document.hidden) clearHeldInputs();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ResizeObserver for crisp responsive projection
    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // WebGL context safety
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    // Simulation Loop with Software-WebGL afterDraw pacing
    let disposed = false;
    let frameId = 0;
    let lastTime = performance.now();
    let hudTimer = 0;
    let outcomeEmitted = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));

      const currentPhase = phaseRef.current;

      if (currentPhase === 'title') {
        outcomeEmitted = false;
        audio.silence();
        titleOrbitAngle += dt * 0.22;
        const orbitR = 9.2;
        camera.position.set(
          vehicle.x + Math.cos(titleOrbitAngle) * orbitR,
          vehicle.y + 3.1,
          vehicle.z + Math.sin(titleOrbitAngle) * orbitR,
        );
        camera.lookAt(vehicle.x, vehicle.y + 0.85, vehicle.z);
        camera.fov = 56;
        camera.updateProjectionMatrix();
      } else if (currentPhase === 'playing') {
        // Build controls from keyboard + touch
        const throttle =
          keysDown.has('KeyW') || keysDown.has('ArrowUp') || touchInputs.throttle ? 1 : 0;
        const brake =
          keysDown.has('KeyS') || keysDown.has('ArrowDown') || touchInputs.brake ? 1 : 0;
        const steerLeft =
          keysDown.has('KeyA') || keysDown.has('ArrowLeft') || touchInputs.left ? 1 : 0;
        const steerRight =
          keysDown.has('KeyD') || keysDown.has('ArrowRight') || touchInputs.right ? 1 : 0;
        const handbrake = keysDown.has('Space') || touchInputs.handbrake;

        const controls: VehicleControls = {
          throttle,
          brake,
          steer: steerLeft - steerRight,
          handbrake,
        };

        // Fixed micro-substepping for stable tire physics even on slow software WebGL frames
        const subSteps = dt > 0.025 ? 2 : 1;
        const subDt = dt / subSteps;
        let maxImpact = 0;
        let shifted = false;

        for (let s = 0; s < subSteps; s++) {
          const res = stepVehiclePhysics(vehicle, controls, subDt);
          if (res.impactIntensity > maxImpact) maxImpact = res.impactIntensity;
          if (res.gearChanged) shifted = true;
        }

        if (shifted) {
          audio.playShiftClunk();
        }
        if (maxImpact > 4.5) {
          cameraTrauma = Math.min(1, cameraTrauma + Math.min(0.75, maxImpact * 0.04));
          audio.playCollisionThud(maxImpact);
        }

        // Update mission / freeroam state
        const mEvents = stepMissionProgress(missionState, vehicle, dt);
        if (mEvents.checkpointCleared) {
          audio.playCheckpointChime();
          callbacksRef.current.onToast('Checkpoint Cleared!');
        }
        if (mEvents.missionFinished && !outcomeEmitted) {
          outcomeEmitted = true;
          audio.silence();
          callbacksRef.current.onMissionOutcome(mEvents.missionFinished, buildSnapshot());
        }

        // Update procedural audio
        audio.update(
          vehicle.rpm,
          throttle,
          vehicle.speedKmh,
          vehicle.rearSlipRatio,
          true,
        );

        // Emit tire smoke particles when drifting or spinning tires off-road
        if ((vehicle.rearSlipRatio > 0.35 && vehicle.speedKmh > 16) || (vehicle.surface !== 'asphalt' && vehicle.speedKmh > 25)) {
          smokeAccum += dt;
          if (smokeAccum > 0.045) {
            smokeAccum = 0;
            const sinH = Math.sin(vehicle.heading);
            const cosH = Math.cos(vehicle.heading);
            const rx = vehicle.x - sinH * 1.35;
            const rz = vehicle.z - cosH * 1.35;
            spawnSmokePuff(world.smokePool, rx - cosH * 0.75, vehicle.y + 0.25, rz + sinH * 0.75, -vehicle.vx * 0.15, -vehicle.vz * 0.15);
            spawnSmokePuff(world.smokePool, rx + cosH * 0.75, vehicle.y + 0.25, rz - sinH * 0.75, -vehicle.vx * 0.15, -vehicle.vz * 0.15);
          }
        }
        stepSmokePool(world.smokePool, dt);

        // Camera choreography with exponential damping & speed-coupled FOV
        const sinH = Math.sin(vehicle.heading);
        const cosH = Math.cos(vehicle.heading);
        _fwd.set(sinH, 0, cosH);
        _right.set(-cosH, 0, sinH);

        if (cameraMode === 'hood') {
          _camDesired.set(
            vehicle.x + sinH * 0.55,
            vehicle.y + 1.32,
            vehicle.z + cosH * 0.55,
          );
          _camTarget.set(
            vehicle.x + sinH * 18,
            vehicle.y + 1.15,
            vehicle.z + cosH * 18,
          );
          camera.position.lerp(_camDesired, 1 - Math.exp(-26 * dt));
          camera.lookAt(_camTarget);
          const targetFov = 68 + Math.min(14, vehicle.speedKmh * 0.08);
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
        } else {
          const distBack = cameraMode === 'far' ? 11.2 : 7.6;
          const heightUp = cameraMode === 'far' ? 4.2 : 2.75;
          _camDesired.set(
            vehicle.x - sinH * distBack,
            Math.max(groundHeightAt(vehicle.x - sinH * distBack, vehicle.z - cosH * distBack) + 1.1, vehicle.y + heightUp),
            vehicle.z - cosH * distBack,
          );
          _camTarget.set(
            vehicle.x + sinH * 4.5,
            vehicle.y + 1.1,
            vehicle.z + cosH * 4.5,
          );
          const dampK = 1 - Math.exp(-9.5 * dt);
          camera.position.lerp(_camDesired, dampK);

          // Camera shake trauma
          if (cameraTrauma > 0.001) {
            const shake = cameraTrauma * cameraTrauma * 0.35;
            camera.position.x += (Math.random() - 0.5) * shake;
            camera.position.y += (Math.random() - 0.5) * shake;
            cameraTrauma = Math.max(0, cameraTrauma - dt * 1.9);
          }

          camera.lookAt(_camTarget);
          const targetFov = (cameraMode === 'far' ? 64 : 60) + Math.min(14, vehicle.speedKmh * 0.08);
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 5, dt);
        }
        camera.updateProjectionMatrix();
      } else {
        // Paused or Game Over: keep engine silent
        audio.silence();
      }

      // Sync 3D Car Rig transforms
      world.car.root.position.set(vehicle.x, vehicle.y, vehicle.z);
      world.car.root.rotation.set(0, vehicle.heading, 0);
      world.car.chassisGroup.rotation.set(vehicle.pitch, 0, vehicle.roll);
      world.car.frontLeftKnuckle.rotation.y = vehicle.steerAngle;
      world.car.frontRightKnuckle.rotation.y = vehicle.steerAngle;
      for (let i = 0; i < world.car.wheels.length; i++) {
        world.car.wheels[i].rotation.x = vehicle.wheelSpin;
      }
      world.car.brakeMat.emissiveIntensity = vehicle.brakingLights ? 2.4 : 0.35;
      world.car.reverseMat.emissiveIntensity = vehicle.reverseLights ? 2.0 : 0.0;

      // Keep shadow frustum centered near car
      if (!isSoftwareGl) {
        world.sunLight.position.set(vehicle.x + 65, vehicle.y + 80, vehicle.z + 50);
        world.sunLight.target.position.set(vehicle.x, vehicle.y, vehicle.z);
        world.sunLight.target.updateMatrixWorld();
      }

      // Update Mission Checkpoint beacon in 3D world
      const activeMission = getActiveMission(missionState);
      const cp = activeMission?.checkpoints[missionState.checkpointIndex] ?? null;
      if (missionState.status === 'active' && cp) {
        world.checkpointGroup.visible = true;
        world.checkpointGroup.position.set(cp.x, groundHeightAt(cp.x, cp.z), cp.z);
        world.checkpointRing.rotation.z += dt * 1.6;
      } else {
        world.checkpointGroup.visible = false;
      }

      renderer.render(world.scene, camera);

      // Throttled <= 10Hz telemetry update to React HUD
      hudTimer += dt;
      if (hudTimer >= 0.1) {
        hudTimer = 0;
        callbacksRef.current.onTelemetry(buildSnapshot());
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    // Push initial telemetry snapshot
    callbacksRef.current.onTelemetry(buildSnapshot());
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeldInputs);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      audio.dispose();
      world.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [bridgeRef, initialTransmission]);

  return <div ref={mountRef} className="fixed inset-0 h-full w-full overflow-hidden bg-[#0B0E14]" />;
};
