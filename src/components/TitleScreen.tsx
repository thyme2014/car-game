import React from 'react';
import { MISSIONS } from '../game/missions';
import { TransmissionMode } from '../game/vehiclePhysics';

interface TitleScreenProps {
  selectedTransmission: TransmissionMode;
  onSelectTransmission: (mode: TransmissionMode) => void;
  selectedMissionId: string | null;
  onSelectMission: (missionId: string | null) => void;
  onStart: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedTransmission,
  onSelectTransmission,
  selectedMissionId,
  onSelectMission,
  onStart,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between bg-gradient-to-r from-[#0B0E14]/90 via-[#0B0E14]/50 to-transparent p-8 md:p-12">
      {/* Top-left negative-space Title Lockup + Config */}
      <div className="pointer-events-auto max-w-md space-y-6">
        {/* Custom SVG Automotive Emblem + Title */}
        <div className="flex items-center gap-3.5">
          <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0" aria-hidden="true">
            <polygon
              points="24,3 44,14 44,34 24,45 4,34 4,14"
              fill="#111827"
              stroke="#F59E0B"
              strokeWidth="2.5"
            />
            <path
              d="M14 31 L24 13 L34 31 M18.5 25 H29.5"
              fill="none"
              stroke="#F8FAFC"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="24" cy="36" r="2.2" fill="#06B6D4" />
          </svg>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight text-white md:text-5xl">
              APEX HORIZON
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-300">
              Open-World GT Driving Simulator
            </p>
          </div>
        </div>

        {/* Transmission selector */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Transmission
          </div>
          <div className="inline-flex rounded-lg border border-white/15 bg-[#0B0E14]/85 p-1">
            <button
              type="button"
              onClick={() => onSelectTransmission('auto')}
              className={`whitespace-nowrap shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                selectedTransmission === 'auto'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Automatic
            </button>
            <button
              type="button"
              onClick={() => onSelectTransmission('manual')}
              className={`whitespace-nowrap shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                selectedTransmission === 'manual'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Manual 6-Speed
            </button>
          </div>
        </div>

        {/* Mode / Starting Objective Selector */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Drive Mode
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onSelectMission(null)}
              className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-left transition-colors ${
                selectedMissionId === null
                  ? 'border-cyan-400 bg-cyan-500/15 text-white'
                  : 'border-white/10 bg-[#0B0E14]/80 text-slate-300 hover:border-white/25'
              }`}
            >
              <div>
                <div className="font-display text-sm font-bold">Open-World Freeroam</div>
                <div className="text-xs text-slate-400">
                  Explore the valley, coastal harbor, proving ground, and summit ridge
                </div>
              </div>
            </button>

            {MISSIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectMission(m.id)}
                className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-left transition-colors ${
                  selectedMissionId === m.id
                    ? 'border-amber-400 bg-amber-500/15 text-white'
                    : 'border-white/10 bg-[#0B0E14]/80 text-slate-300 hover:border-white/25'
                }`}
              >
                <div>
                  <div className="font-display text-sm font-bold">{m.title}</div>
                  <div className="text-xs text-slate-400">{m.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Primary Start CTA */}
        <div>
          <button
            type="button"
            data-start="true"
            onClick={onStart}
            className="font-display inline-flex items-center justify-center rounded-lg bg-amber-500 px-8 py-3.5 text-base font-bold tracking-wide text-slate-950 shadow-lg transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-white active:scale-[0.99]"
          >
            Start Driving
          </button>
        </div>
      </div>

      {/* Bottom clean inline control hints */}
      <div className="text-xs font-medium tracking-wide text-slate-300 hud-text-shadow">
        W/S Throttle & Brake · A/D Steer · E/Q Shift Up/Down · M Auto/Manual · Space Handbrake · C Camera · Tab Missions · Esc Pause
      </div>
    </div>
  );
};
