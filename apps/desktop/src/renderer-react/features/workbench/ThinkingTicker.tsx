import React, { memo, useEffect, useMemo, useRef } from "react";
import { splitThinkingChunks } from "./thinkingChunks";

/** A poll can deliver several chunks at once; the reel spins through at most this many. */
const MAX_ROLL_LINES = 6;
const ROLL_BASE_MS = 110;
const ROLL_STEP_MS = 45;
const ROLL_MAX_MS = 320;

/**
 * iOS-clock style reel for model reasoning: a one-line window over the tail of
 * the thinking text that rolls upward whenever new reasoning lines arrive.
 *
 * The track holds the line that is leaving plus the incoming lines, so a step
 * shows both mid-roll — the wheel effect — and the finished state is the `to`
 * keyframe, so a re-render that only grows the open line never jumps.
 */
export const ThinkingTicker = memo(function ThinkingTicker({
  text,
  className = ""
}: {
  text: string;
  className?: string;
}): React.JSX.Element | null {
  const chunks = useMemo(() => splitThinkingChunks(text), [text]);
  const previousRef = useRef<{ text: string; count: number } | null>(null);
  const previous = previousRef.current;

  // Committed in an effect (never during render) so a double-invoked render
  // cannot consume the growth a second time.
  useEffect(() => {
    if (previousRef.current?.text !== text) previousRef.current = { text, count: chunks.length };
  }, [chunks.length, text]);

  if (!chunks.length) return null;

  // Lines that arrived since the last commit; 0 on mount or when the open line
  // only grew, which keeps that case completely still.
  const roll = previous && previous.text !== text
    ? Math.min(Math.max(chunks.length - previous.count, 0), MAX_ROLL_LINES)
    : 0;
  const track = chunks.slice(-(1 + roll));
  const shift = track.length - 1;
  const duration = Math.min(ROLL_BASE_MS + ROLL_STEP_MS * shift, ROLL_MAX_MS);

  return (
    <div
      className={`wb-thinking-ticker${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        ["--wb-thinking-shift" as string]: String(shift),
        ["--wb-thinking-duration" as string]: `${duration}ms`
      }}
    >
      {/* Remounting on a new line restarts the roll animation. */}
      <div className="wb-thinking-ticker-track" key={chunks.length}>
        {track.map((chunk, index) => (
          <div className="wb-thinking-ticker-line" key={index}>{chunk}</div>
        ))}
      </div>
    </div>
  );
});
