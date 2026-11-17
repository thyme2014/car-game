import React from 'react';
import { MISSIONS } from '../game/missions';
import { HudTelemetry } from '../game/types';
import { TransmissionMode } from '../game/vehiclePhysics';

interface MissionDrawerProps {
  open: boolean;
  activeMissionId: string | null;
  onClose: () => void;
  onSelectFreeroam: () => void;
  onSelectMission: (missionId: string) => void;
}

export const MissionDrawer: React.FC<MissionDrawerProps> = ({
  open,
  activeMissionId,
  onClose,
  onSelectFreeroam,
  onSelectMission,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Missions and Freeroam Selector"
      className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-white/15 bg-[#0B0E14] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
          <div>
            <h2 className="font-display text-xl font-bold text-white">Drive Modes & Missions</h2>
            <p className="text-xs text-slate-400">Switch seamlessly between open-world freeroam and timed events</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close missions menu"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          <button
            type="button"
            onClick={() => {
              onSelectFreeroam();
              onClose();
            }}
            className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
              activeMissionId === null
                ? 'border-cyan-400 bg-cyan-500/15'
                : 'border-white/10 bg-white/5 hover:border-white/25'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-base font-bold text-white">Open-World Freeroam</span>
              <span className="text-xs font-semibold text-cyan-300">
                {activeMissionId === null ? 'Active' : 'Select'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              Unlimited driving across coastal highways, downtown streets, mountain switchbacks, and skidpad.
            </p>
          </button>

          {MISSIONS.map((m) => {
            const isActive = activeMissionId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelectMission(m.id);
                  onClose();
                }}
                className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                  isActive
                    ? 'border-amber-400 bg-amber-500/15'
                    : 'border-white/10 bg-white/5 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-base font-bold text-white">{m.title}</span>
                  <span className="font-mono-num text-xs font-semibold text-amber-400">
                    {m.timeLimitSec}s Limit
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-300">{m.subtitle}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface PauseModalProps {
  transmission: TransmissionMode;
  onResume: () => void;
  onRestart: () => void;
  onToggleTransmission: () => void;
  onReturnTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  transmission,
  onResume,
  onRestart,
  onToggleTransmission,
  onReturnTitle,
}) => {
  return (
    <div
      role="dialog"
      aria-label="Simulation Paused"
      className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-4"
    >
      <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#0B0E14] p-6 shadow-2xl">
        <h2 className="font-display text-2xl font-bold text-white">Paused</h2>
        <p className="mt-1 text-xs text-slate-400">
          W/S Throttle & Brake · A/D Steer · E/Q Shift · Space Handbrake
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="font-display w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
          >
            Resume Driving
          </button>
          <button
            type="button"
            onClick={onToggleTransmission}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            Transmission: {transmission === 'auto' ? 'Automatic' : 'Manual 6-Speed'}
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            Reset / Restart
          </button>
          <button
            type="button"
            onClick={onReturnTitle}
            className="w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-white"
          >
            Return to Title
          </button>
        </div>
      </div>
    </div>
  );
};

interface OutcomeModalProps {
  outcome: 'completed' | 'failed';
  snapshot: HudTelemetry;
  bestTimeSec: number | null;
  onRetry: () => void;
  onSwitchFreeroam: () => void;
}

export const OutcomeModal: React.FC<OutcomeModalProps> = ({
  outcome,
  snapshot,
  bestTimeSec,
  onRetry,
  onSwitchFreeroam,
}) => {
  const mission = MISSIONS.find((m) => m.id === snapshot.activeMissionId);
  const isWin = outcome === 'completed';

  return (
    <div
      role="dialog"
      aria-label={isWin ? 'Mission Completed' : 'Mission Failed'}
      className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#0B0E14] p-6 shadow-2xl">
        <div className={`text-xs font-bold uppercase tracking-wider ${isWin ? 'text-cyan-400' : 'text-red-400'}`}>
          {isWin ? 'Mission Complete' : 'Mission Failed'}
        </div>
        <h2 className="font-display mt-1 text-2xl font-bold text-white">
          {mission?.title ?? 'Event Result'}
        </h2>
        {!isWin && snapshot.failReason && (
          <p className="mt-1.5 text-sm text-slate-300">{snapshot.failReason}</p>
        )}

        <div className="mt-5 grid grid-cols-3 gap-3 rounded-lg border border-white/10 bg-white/5 p-3.5">
          <div>
            <div className="text-[11px] text-slate-400">Time</div>
            <div className="font-mono-num mt-0.5 text-lg font-bold text-white">
              {(snapshot.completionTimeSec ?? snapshot.elapsedSec).toFixed(1)}s
            </div>
            {bestTimeSec !== null && (
              <div className="font-mono-num text-[10px] text-cyan-300">
                Best {bestTimeSec.toFixed(1)}s
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] text-slate-400">Top Speed</div>
            <div className="font-mono-num mt-0.5 text-lg font-bold text-white">
              {Math.round(snapshot.topSpeedKmh)} km/h
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">Drift Pts</div>
            <div className="font-mono-num mt-0.5 text-lg font-bold text-amber-400">
              {Math.round(snapshot.driftScore)}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onRetry}
            className="font-display flex-1 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
          >
            {isWin ? 'Drive Again' : 'Try Again'}
          </button>
          <button
            type="button"
            onClick={onSwitchFreeroam}
            className="flex-1 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            Switch to Freeroam
          </button>
        </div>
      </div>
    </div>
  );
};
