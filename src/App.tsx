import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DrivingCanvas } from './components/DrivingCanvas';
import { MissionDrawer, OutcomeModal, PauseModal } from './components/GameModals';
import { MinimapHUD } from './components/MinimapHUD';
import { TachometerCluster } from './components/TachometerCluster';
import { TitleScreen } from './components/TitleScreen';
import { MISSIONS } from './game/missions';
import { DrivingBridge, GamePhase, HudTelemetry } from './game/types';
import { TransmissionMode } from './game/vehiclePhysics';
import { INITIAL_SPAWN } from './game/worldData';

const INITIAL_TELEMETRY: HudTelemetry = {
  speedKmh: 0,
  rpm: 850,
  gear: 1,
  transmission: 'auto',
  surface: 'asphalt',
  damage: 0,
  revLimiterHit: false,
  braking: false,
  handbrake: false,
  x: INITIAL_SPAWN.x,
  z: INITIAL_SPAWN.z,
  heading: INITIAL_SPAWN.heading,
  zoneName: 'Coastal Grand Blvd',
  cameraMode: 'chase',
  activeMissionId: null,
  missionStatus: 'freeroam',
  failReason: null,
  elapsedSec: 0,
  remainingSec: 0,
  checkpointIndex: 0,
  checkpointCount: 0,
  nextCheckpointX: null,
  nextCheckpointZ: null,
  nextCheckpointLabel: null,
  driftScore: 0,
  topSpeedKmh: 0,
  distanceMeters: 0,
  completionTimeSec: null,
};

export default function App() {
  const autoStart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [phase, setPhase] = useState<GamePhase>(autoStart ? 'playing' : 'title');
  const [selectedTransmission, setSelectedTransmission] = useState<TransmissionMode>('auto');
  const [selectedStartMission, setSelectedStartMission] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<HudTelemetry>(INITIAL_TELEMETRY);
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    status: 'completed' | 'failed';
    snapshot: HudTelemetry;
  } | null>(null);
  const [bestTimes, setBestTimes] = useState<Record<string, number>>({});

  const bridgeRef = useRef<DrivingBridge | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Sync game state machine to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2200);
  }, []);

  const handleStartFromTitle = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    bridgeRef.current?.setTransmission(selectedTransmission);
    if (selectedStartMission) {
      bridgeRef.current?.startMission(selectedStartMission);
    } else {
      bridgeRef.current?.startFreeroam();
    }
    setOutcome(null);
    setMissionsOpen(false);
    setPhase('playing');
  }, [selectedStartMission, selectedTransmission]);

  const handleMissionOutcome = useCallback(
    (status: 'completed' | 'failed', snapshot: HudTelemetry) => {
      setOutcome({ status, snapshot });
      if (status === 'completed' && snapshot.activeMissionId && snapshot.completionTimeSec !== null) {
        const mId = snapshot.activeMissionId;
        const time = snapshot.completionTimeSec;
        setBestTimes((prev) => ({
          ...prev,
          [mId]: prev[mId] !== undefined ? Math.min(prev[mId], time) : time,
        }));
      }
      setPhase('gameover');
    },
    [],
  );

  // Global Shell hotkeys (Title Enter/Space, Playing Esc/P/Tab)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (phase === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartFromTitle();
        }
        return;
      }

      if (phase === 'playing') {
        if (e.code === 'Tab') {
          e.preventDefault();
          setMissionsOpen((prev) => !prev);
          return;
        }
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          if (missionsOpen) {
            setMissionsOpen(false);
          } else {
            setPhase('paused');
          }
        }
      } else if (phase === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          setPhase('playing');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStartFromTitle, missionsOpen, phase]);

  const activeMissionDef = telemetry.activeMissionId
    ? MISSIONS.find((m) => m.id === telemetry.activeMissionId) ?? null
    : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0B0E14]">
      {/* Isolated 3D WebGL Viewport */}
      <DrivingCanvas
        phase={phase}
        muted={muted}
        initialTransmission={selectedTransmission}
        onTelemetry={setTelemetry}
        onMissionOutcome={handleMissionOutcome}
        onToast={showToast}
        bridgeRef={bridgeRef}
      />

      {/* Title Screen */}
      {phase === 'title' && (
        <TitleScreen
          selectedTransmission={selectedTransmission}
          onSelectTransmission={setSelectedTransmission}
          selectedMissionId={selectedStartMission}
          onSelectMission={setSelectedStartMission}
          onStart={handleStartFromTitle}
        />
      )}

      {/* Playing HUD Overlay (pointer-events-none wrapper, >=85% unobstructed center) */}
      {phase === 'playing' && (
        <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 md:p-5">
          {/* Top Row: Left Minimap + Mission Strip, Right Utility Buttons */}
          <div className="flex items-start justify-between gap-4">
            <MinimapHUD
              playerX={telemetry.x}
              playerZ={telemetry.z}
              playerHeading={telemetry.heading}
              zoneName={telemetry.zoneName}
              activeMissionId={telemetry.activeMissionId}
              missionTitle={activeMissionDef?.title ?? null}
              missionKind={activeMissionDef?.kind ?? null}
              remainingSec={telemetry.remainingSec}
              checkpointIndex={telemetry.checkpointIndex}
              checkpointCount={telemetry.checkpointCount}
              nextCheckpointX={telemetry.nextCheckpointX}
              nextCheckpointZ={telemetry.nextCheckpointZ}
              nextCheckpointLabel={telemetry.nextCheckpointLabel}
              driftScore={telemetry.driftScore}
              targetDriftScore={activeMissionDef?.targetDriftScore}
              topSpeedKmh={telemetry.topSpeedKmh}
              distanceMeters={telemetry.distanceMeters}
              damage={telemetry.damage}
              maxAllowedDamage={activeMissionDef?.maxAllowedDamage}
            />

            {/* Top-Right Compact Utility Controls */}
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setMissionsOpen(true);
                }}
                aria-label="Open missions and freeroam selector"
                className="whitespace-nowrap shrink-0 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#0B0E14]/88 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
                <span>Missions [Tab]</span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  bridgeRef.current?.cycleCamera();
                }}
                aria-label="Switch camera view"
                title="Switch Camera (C)"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0B0E14]/88 text-slate-200 shadow-lg hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  bridgeRef.current?.resetCar();
                  showToast('Vehicle Reset');
                }}
                aria-label="Reset vehicle position"
                title="Reset Car (R)"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0B0E14]/88 text-slate-200 shadow-lg hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setMuted((m) => !m);
                }}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                title={muted ? 'Unmute' : 'Mute'}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0B0E14]/88 text-slate-200 shadow-lg hover:bg-white/10"
              >
                {muted ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setPhase('paused');
                }}
                aria-label="Pause simulation"
                title="Pause (Esc)"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0B0E14]/88 text-slate-200 shadow-lg hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Transient Notification Banner (top center, fades out automatically) */}
          {toast && (
            <div className="pointer-events-none fixed left-1/2 top-5 -translate-x-1/2 rounded-lg border border-amber-400/35 bg-[#0B0E14]/92 px-4 py-1.5 text-xs font-bold tracking-wide text-amber-300 shadow-lg">
              {toast}
            </div>
          )}

          {/* Bottom Row: Left Compact Controls + Touch Controls (mobile) / Right Tachometer Cluster */}
          <div className="flex items-end justify-between gap-4">
            {/* Bottom-Left: Subtle control legend on desktop, touch driving pads on mobile */}
            <div className="flex flex-col gap-2">
              <div className="pointer-events-auto flex md:hidden items-center gap-2">
                <button
                  type="button"
                  onPointerDown={() => bridgeRef.current?.setTouchControl('left', true)}
                  onPointerUp={() => bridgeRef.current?.setTouchControl('left', false)}
                  onPointerLeave={() => bridgeRef.current?.setTouchControl('left', false)}
                  aria-label="Steer left"
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/20 bg-[#0B0E14]/85 text-sm font-bold text-white active:bg-amber-500 active:text-slate-950"
                >
                  L
                </button>
                <button
                  type="button"
                  onPointerDown={() => bridgeRef.current?.setTouchControl('right', true)}
                  onPointerUp={() => bridgeRef.current?.setTouchControl('right', false)}
                  onPointerLeave={() => bridgeRef.current?.setTouchControl('right', false)}
                  aria-label="Steer right"
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/20 bg-[#0B0E14]/85 text-sm font-bold text-white active:bg-amber-500 active:text-slate-950"
                >
                  R
                </button>
                <button
                  type="button"
                  onPointerDown={() => bridgeRef.current?.setTouchControl('brake', true)}
                  onPointerUp={() => bridgeRef.current?.setTouchControl('brake', false)}
                  onPointerLeave={() => bridgeRef.current?.setTouchControl('brake', false)}
                  aria-label="Brake or reverse"
                  className="flex h-12 px-3 items-center justify-center rounded-lg border border-red-400/40 bg-[#0B0E14]/85 text-xs font-bold text-red-300 active:bg-red-500 active:text-white"
                >
                  BRK
                </button>
                <button
                  type="button"
                  onPointerDown={() => bridgeRef.current?.setTouchControl('throttle', true)}
                  onPointerUp={() => bridgeRef.current?.setTouchControl('throttle', false)}
                  onPointerLeave={() => bridgeRef.current?.setTouchControl('throttle', false)}
                  aria-label="Throttle"
                  className="flex h-12 px-3 items-center justify-center rounded-lg border border-amber-400/40 bg-[#0B0E14]/85 text-xs font-bold text-amber-300 active:bg-amber-500 active:text-slate-950"
                >
                  GAS
                </button>
              </div>

              <div className="hidden md:block text-[11px] font-medium text-slate-300 hud-text-shadow">
                WASD Drive · Space Handbrake · E/Q Shift · M Auto/Manual · C Camera · R Reset
              </div>
            </div>

            {/* Bottom-Right: Tachometer + Digital Speed + Gear */}
            <TachometerCluster
              speedKmh={telemetry.speedKmh}
              rpm={telemetry.rpm}
              gear={telemetry.gear}
              transmission={telemetry.transmission}
              surface={telemetry.surface}
              damage={telemetry.damage}
              revLimiterHit={telemetry.revLimiterHit}
              braking={telemetry.braking}
              handbrake={telemetry.handbrake}
              onToggleTransmission={() =>
                bridgeRef.current?.setTransmission(
                  telemetry.transmission === 'auto' ? 'manual' : 'auto',
                )
              }
              onShiftUp={() => bridgeRef.current?.shiftUp()}
              onShiftDown={() => bridgeRef.current?.shiftDown()}
            />
          </div>
        </div>
      )}

      {/* Missions & Freeroam Drawer */}
      <MissionDrawer
        open={phase === 'playing' && missionsOpen}
        activeMissionId={telemetry.activeMissionId}
        onClose={() => setMissionsOpen(false)}
        onSelectFreeroam={() => {
          bridgeRef.current?.startFreeroam();
          showToast('Switched to Open-World Freeroam');
        }}
        onSelectMission={(mId) => {
          bridgeRef.current?.startMission(mId);
        }}
      />

      {/* Pause Modal */}
      {phase === 'paused' && (
        <PauseModal
          transmission={telemetry.transmission}
          onResume={() => setPhase('playing')}
          onToggleTransmission={() =>
            bridgeRef.current?.setTransmission(
              telemetry.transmission === 'auto' ? 'manual' : 'auto',
            )
          }
          onRestart={() => {
            bridgeRef.current?.resetCar();
            setPhase('playing');
          }}
          onReturnTitle={() => {
            setMissionsOpen(false);
            setOutcome(null);
            setPhase('title');
          }}
        />
      )}

      {/* Mission Completed / Failed Outcome Modal */}
      {phase === 'gameover' && outcome && (
        <OutcomeModal
          outcome={outcome.status}
          snapshot={outcome.snapshot}
          bestTimeSec={
            outcome.snapshot.activeMissionId
              ? bestTimes[outcome.snapshot.activeMissionId] ?? null
              : null
          }
          onRetry={() => {
            if (outcome.snapshot.activeMissionId) {
              bridgeRef.current?.startMission(outcome.snapshot.activeMissionId);
            }
            setOutcome(null);
            setPhase('playing');
          }}
          onSwitchFreeroam={() => {
            bridgeRef.current?.startFreeroam();
            setOutcome(null);
            setPhase('playing');
          }}
        />
      )}
    </main>
  );
}
