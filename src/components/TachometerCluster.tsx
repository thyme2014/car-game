import React from 'react';
import { formatGearLabel, SPORTS_COUPE_SPEC, TransmissionMode } from '../game/vehiclePhysics';
import { SurfaceType } from '../game/worldData';

interface TachometerClusterProps {
  speedKmh: number;
  rpm: number;
  gear: number;
  transmission: TransmissionMode;
  surface: SurfaceType;
  damage: number;
  revLimiterHit: boolean;
  braking: boolean;
  handbrake: boolean;
  onToggleTransmission: () => void;
  onShiftUp: () => void;
  onShiftDown: () => void;
}

const SURFACE_LABELS: Record<SurfaceType, string> = {
  asphalt: 'Asphalt',
  pad: 'Skidpad',
  shoulder: 'Gravel',
  grass: 'Off-Road',
  sand: 'Coastal Sand',
};

export const TachometerCluster: React.FC<TachometerClusterProps> = ({
  speedKmh,
  rpm,
  gear,
  transmission,
  surface,
  damage,
  revLimiterHit,
  braking,
  handbrake,
  onToggleTransmission,
  onShiftUp,
  onShiftDown,
}) => {
  const maxRpm = 8000;
  const clampedRpm = Math.max(0, Math.min(maxRpm, rpm));
  const rpmRatio = clampedRpm / maxRpm;

  // Sweep from -215 deg to +35 deg (250 deg total sweep)
  const startAngle = -215;
  const totalSweep = 250;
  const needleAngle = startAngle + rpmRatio * totalSweep;

  const cx = 86;
  const cy = 86;
  const radius = 68;

  const polarToCartesian = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (startDeg: number, endDeg: number, r: number) => {
    const s = polarToCartesian(startDeg, r);
    const e = polarToCartesian(endDeg, r);
    const largeArc = endDeg - startDeg <= 180 ? '0' : '1';
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  };

  const redlineStartDeg = startAngle + (SPORTS_COUPE_SPEC.redlineRpm / maxRpm) * totalSweep;
  const activeEndDeg = Math.max(startAngle + 1, needleAngle);
  const needleTip = polarToCartesian(needleAngle, radius - 10);
  const needleBase = polarToCartesian(needleAngle + 180, 12);

  const gearText = formatGearLabel(gear);
  const integrity = Math.max(0, Math.round(100 - damage));

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0B0E14]/88 px-4 py-3 shadow-2xl">
        {/* Left column: Transmission, Gear & Shift Paddles */}
        <div className="flex flex-col items-center justify-between gap-2 border-r border-white/10 pr-3.5">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleTransmission();
            }}
            aria-label={`Switch transmission mode, currently ${transmission}`}
            className="whitespace-nowrap shrink-0 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold tracking-wider text-slate-200 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            {transmission === 'auto' ? 'AUTO [M]' : 'MANUAL [M]'}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onShiftDown();
              }}
              aria-label="Shift down"
              title="Shift Down (Q)"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition-colors hover:bg-white/15 active:scale-95"
            >
              -
            </button>

            <div
              data-testid="gear-display"
              className={`font-display flex h-12 w-12 items-center justify-center rounded-lg border text-3xl font-bold tracking-tight ${
                revLimiterHit
                  ? 'border-red-500/80 bg-red-500/20 text-red-400'
                  : gear === -1
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-300'
                    : 'border-amber-400/40 bg-amber-500/10 text-amber-400'
              }`}
            >
              {gearText}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onShiftUp();
              }}
              aria-label="Shift up"
              title="Shift Up (E)"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-xs font-bold text-slate-300 transition-colors hover:bg-white/15 active:scale-95"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400">
            <span>Q/E Shift</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                transmission === 'manual' && rpm >= 6400 && gear < 6
                  ? 'text-red-400 font-bold'
                  : handbrake
                    ? 'text-amber-400 font-semibold'
                    : braking
                      ? 'text-red-400 font-semibold'
                      : ''
              }
            >
              {transmission === 'manual' && rpm >= 6400 && gear < 6
                ? 'SHIFT UP'
                : handbrake
                  ? 'H-BRAKE'
                  : braking
                    ? 'BRAKE'
                    : SURFACE_LABELS[surface]}
            </span>
          </div>
        </div>

        {/* Right column: SVG Analog Tachometer + Digital Speed */}
        <div className="relative h-[168px] w-[172px]">
          <svg viewBox="0 0 172 168" className="h-full w-full overflow-visible" aria-hidden="true">
            {/* Base track */}
            <path
              d={describeArc(startAngle, startAngle + totalSweep, radius)}
              fill="none"
              stroke="rgba(148,163,184,0.18)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Redline zone */}
            <path
              d={describeArc(redlineStartDeg, startAngle + totalSweep, radius)}
              fill="none"
              stroke="rgba(239,68,68,0.55)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Active RPM arc */}
            <path
              d={describeArc(startAngle, activeEndDeg, radius)}
              fill="none"
              stroke={revLimiterHit ? '#ef4444' : '#f59e0b'}
              strokeWidth="8"
              strokeLinecap="round"
            />

            {/* Tick marks 0..8 x1000 */}
            {Array.from({ length: 9 }).map((_, idx) => {
              const deg = startAngle + (idx / 8) * totalSweep;
              const p1 = polarToCartesian(deg, radius - 13);
              const p2 = polarToCartesian(deg, radius - 5);
              const labelPos = polarToCartesian(deg, radius - 24);
              const isRed = idx >= 7;
              return (
                <g key={idx}>
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={isRed ? '#ef4444' : '#94a3b8'}
                    strokeWidth={2}
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y + 3.5}
                    textAnchor="middle"
                    className="fill-slate-400 text-[9px] font-semibold"
                  >
                    {idx}
                  </text>
                </g>
              );
            })}

            {/* Needle */}
            <line
              x1={needleBase.x}
              y1={needleBase.y}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke="#ef4444"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r="5" fill="#e2e8f0" />
          </svg>

          {/* Center digital speed readout */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-2">
            <div
              data-testid="speed-display"
              className="font-display font-mono-num text-3xl font-bold leading-none tracking-tight text-white"
            >
              {Math.round(speedKmh)}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold tracking-widest text-slate-400">
              KM/H · {Math.round(clampedRpm)} RPM
            </div>
            {/* Integrity bar */}
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[9px] font-semibold text-slate-400">CAR</span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all duration-150 ${
                    integrity > 60 ? 'bg-cyan-400' : integrity > 30 ? 'bg-amber-400' : 'bg-red-500'
                  }`}
                  style={{ width: `${integrity}%` }}
                />
              </div>
              <span className="font-mono-num text-[9px] text-slate-300">{integrity}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
