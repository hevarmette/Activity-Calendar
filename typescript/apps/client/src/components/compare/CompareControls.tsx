import { convertSecondsToHms } from "@activity-calendar/shared";
import { OffsetControl } from "./OffsetControl.js";

const SPEEDS = [0.5, 1, 20, 30, 60, 120] as const;

interface Props {
  isPlaying: boolean;
  onPlayPause: () => void;
  /** Shared clock in seconds. */
  clock: number;
  /** Playback range upper bound in seconds. */
  maxClock: number;
  onScrub: (seconds: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  offsetA: number;
  offsetB: number;
  onOffsetA: (seconds: number) => void;
  onOffsetB: (seconds: number) => void;
  maxA: number;
  maxB: number;
  colorA: string;
  colorB: string;
  nameA: string;
  nameB: string;
}

/**
 * Presentational playback controls for the compare animation: play/pause, a
 * draggable timeline scrubber, a playback-speed pill group (0.5×–8×) styled like
 * the LapTable filter pills, and a per-activity start-offset control each. All
 * state lives in the page; this component only renders and forwards events.
 */
export function CompareControls({
  isPlaying,
  onPlayPause,
  clock,
  maxClock,
  onScrub,
  speed,
  onSpeedChange,
  offsetA,
  offsetB,
  onOffsetA,
  onOffsetB,
  maxA,
  maxB,
  colorA,
  colorB,
  nameA,
  nameB,
}: Props) {
  return (
    <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPlayPause}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white transition-colors hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
        >
          {isPlaying ? (
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <rect x="5" y="4" width="4" height="12" rx="1" />
              <rect x="11" y="4" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M6 4.5v11a1 1 0 0 0 1.5.87l9-5.5a1 1 0 0 0 0-1.74l-9-5.5A1 1 0 0 0 6 4.5Z" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.ceil(maxClock))}
          step={0.5}
          value={Math.min(clock, maxClock)}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Playback timeline"
          className="min-w-0 flex-1 accent-orange-500"
        />
        <span className="w-32 shrink-0 text-right text-xs text-gray-400 tabular-nums">
          {convertSecondsToHms(clock) ?? "0:00.00"} /{" "}
          {convertSecondsToHms(maxClock) ?? "0:00.00"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-500">Speed</span>
        <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              aria-pressed={speed === s}
              className={
                speed === s
                  ? "rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
              }
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-gray-800 pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Start Offset
        </p>
        <OffsetControl
          label={nameA}
          color={colorA}
          value={offsetA}
          max={maxA}
          onChange={onOffsetA}
        />
        <OffsetControl
          label={nameB}
          color={colorB}
          value={offsetB}
          max={maxB}
          onChange={onOffsetB}
        />
      </div>
    </div>
  );
}
