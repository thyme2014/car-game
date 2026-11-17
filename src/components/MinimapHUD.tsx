import React, { useMemo } from 'react';
import {
  CROSS_ROAD_POINTS,
  HARBOR_SPUR_POINTS,
  LANDMARKS,
  OUTER_LOOP_POINTS,
  PROVING_PAD,
  RoadPoint,
  SUMMIT_SPUR_POINTS,
  WORLD_HALF_EXTENT,
} from '../game/worldData';

interface MinimapHUDProps {
  playerX: number;
  playerZ: number;
  playerHeading: number;
  zoneName: string;
  activeMissionId: string | null;
  missionTitle: string | null;
  missionKind: string | null;
  remainingSec: number;
  checkpointIndex: number;
  checkpointCount: number;
  nextCheckpointX: number | null;
  nextCheckpointZ: number | null;
  nextCheckpointLabel: string | null;
  driftScore: number;
  targetDriftScore?: number;
  topSpeedKmh: number;
  distanceMeters: number;
  damage: number;
  maxAllowedDamage?: number;
}

const MAP_SIZE = 156;

function worldToMap(wx: number, wz: number): { x: number; y: number } {
  const normX = (wx + WORLD_HALF_EXTENT) / (WORLD_HALF_EXTENT * 2);
  const normY = (wz + WORLD_HALF_EXTENT) / (WORLD_HALF_EXTENT * 2);
  return {
    x: normX * MAP_SIZE,
    y: normY * MAP_SIZE,
  };
}

function pointsToPath(pts: RoadPoint[], closed: boolean): string {
  if (pts.length === 0) return '';
  const cmds = pts.map((p, idx) => {
    const m = worldToMap(p.x, p.z);
    return `${idx === 0 ? 'M' : 'L'} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
  });
  if (closed) cmds.push('Z');
  return cmds.join(' ');
}

export const MinimapHUD: React.FC<MinimapHUDProps> = ({
  playerX,
  playerZ,
  playerHeading,
  zoneName,
  activeMissionId,
  missionTitle,
  missionKind,
  remainingSec,
  checkpointIndex,
  checkpointCount,
  nextCheckpointX,
  nextCheckpointZ,
  nextCheckpointLabel,
  driftScore,
  targetDriftScore,
  topSpeedKmh,
  distanceMeters,
  damage,
  maxAllowedDamage,
}) => {
  const roadPaths = useMemo(() => {
    return {
      outer: pointsToPath(OUTER_LOOP_POINTS, true),
      cross: pointsToPath(CROSS_ROAD_POINTS, false),
      summit: pointsToPath(SUMMIT_SPUR_POINTS, false),
      harbor: pointsToPath(HARBOR_SPUR_POINTS, false),
    };
  }, []);

  const playerPos = worldToMap(playerX, playerZ);
  const padPos = worldToMap(PROVING_PAD.x, PROVING_PAD.z);
  const padR = (PROVING_PAD.radius / (WORLD_HALF_EXTENT * 2)) * MAP_SIZE;
  const cpPos =
    nextCheckpointX !== null && nextCheckpointZ !== null
      ? worldToMap(nextCheckpointX, nextCheckpointZ)
      : null;

  // Player heading: heading = 0 faces +Z (down on map), heading = +PI/2 faces +X (right on map)
  // SVG triangle points up (0, -6), so rotation degrees = 180 - headingDeg
  const headingDeg = 180 - (playerHeading * 180) / Math.PI;

  const formatTimer = (sec: number) => {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  return (
    <div className="pointer-events-none flex items-start gap-3">
      {/* Minimap box */}
      <div className="relative h-[156px] w-[156px] overflow-hidden rounded-xl border border-white/15 bg-[#0B0E14]/90 shadow-xl">
        <svg viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`} className="h-full w-full">
          {/* Bay ocean corner hint (SW) */}
          <circle cx="10" cy={MAP_SIZE - 14} r="36" fill="rgba(14,116,144,0.3)" />

          {/* Proving ground skidpad */}
          <circle cx={padPos.x} cy={padPos.y} r={padR} fill="rgba(148,163,184,0.22)" />

          {/* Real open-world road splines */}
          <path d={roadPaths.outer} fill="none" stroke="#475569" strokeWidth="4.5" strokeLinejoin="round" />
          <path d={roadPaths.cross} fill="none" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
          <path d={roadPaths.summit} fill="none" stroke="#475569" strokeWidth="3.5" strokeLinecap="round" />
          <path d={roadPaths.harbor} fill="none" stroke="#475569" strokeWidth="3.5" strokeLinecap="round" />

          {/* Landmark markers */}
          {LANDMARKS.map((lm) => {
            const p = worldToMap(lm.x, lm.z);
            return (
              <g key={lm.id}>
                <circle cx={p.x} cy={p.y} r="2.2" fill="#94a3b8" />
                <text
                  x={p.x}
                  y={p.y - 4}
                  textAnchor="middle"
                  className="fill-slate-400 text-[6.5px] font-bold"
                >
                  {lm.shortLabel}
                </text>
              </g>
            );
          })}

          {/* Active Mission Checkpoint */}
          {cpPos && (
            <g>
              <circle cx={cpPos.x} cy={cpPos.y} r="7" fill="rgba(245,158,11,0.28)" />
              <circle cx={cpPos.x} cy={cpPos.y} r="3.6" fill="#f59e0b" stroke="#0b0e14" strokeWidth="1" />
            </g>
          )}

          {/* Player heading arrow */}
          <g transform={`translate(${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}) rotate(${headingDeg.toFixed(1)})`}>
            <polygon points="0,-6.5 4.5,5 0,2.5 -4.5,5" fill="#06b6d4" stroke="#ffffff" strokeWidth="0.9" />
          </g>
        </svg>

        <div className="absolute bottom-1 left-2 right-2 truncate text-center text-[10px] font-semibold tracking-wide text-slate-300 hud-text-shadow">
          {zoneName}
        </div>
      </div>

      {/* Mission Objective or Freeroam Telemetry Strip */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-[#0B0E14]/88 px-3.5 py-2.5 shadow-xl min-w-[215px]">
        {activeMissionId && missionTitle ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                Active Mission
              </span>
              <span
                data-testid="mission-timer"
                className={`font-mono-num text-lg font-bold leading-none ${
                  remainingSec <= 15 ? 'text-red-400' : 'text-white'
                }`}
              >
                {formatTimer(remainingSec)}
              </span>
            </div>
            <div className="font-display text-sm font-bold text-white">{missionTitle}</div>
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span data-testid="checkpoint-counter" className="font-mono-num font-semibold text-cyan-300">
                Gate {checkpointIndex}/{checkpointCount}
              </span>
              {nextCheckpointLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate max-w-[140px]">{nextCheckpointLabel}</span>
                </>
              )}
            </div>
            {missionKind === 'drift-apex' && targetDriftScore && (
              <div className="mt-0.5 text-xs text-slate-300">
                Drift Points:{' '}
                <span className="font-mono-num font-bold text-amber-400">
                  {Math.round(driftScore)} / {targetDriftScore}
                </span>
              </div>
            )}
            {missionKind === 'delivery' && maxAllowedDamage !== undefined && (
              <div className="mt-0.5 text-xs text-slate-300">
                Cargo Integrity:{' '}
                <span className="font-mono-num font-bold text-cyan-300">
                  {Math.max(0, Math.round(100 - damage))}% (min {100 - maxAllowedDamage}%)
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                Open-World Freeroam
              </span>
            </div>
            <div className="mt-0.5 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[10px] text-slate-400">Distance</div>
                <div className="font-mono-num font-bold text-white">
                  {(distanceMeters / 1000).toFixed(2)} km
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Top Speed</div>
                <div className="font-mono-num font-bold text-white">
                  {Math.round(topSpeedKmh)} km/h
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Drift Pts</div>
                <div className="font-mono-num font-bold text-amber-400">
                  {Math.round(driftScore)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
