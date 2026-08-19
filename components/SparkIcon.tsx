/**
 * The agent emblem. Keep it inline: the earlier CSS mask referenced an
 * untracked raster file, leaving every instance blank and producing
 * a 404 on each page load. `currentColor` preserves the existing per-agent
 * tinting without a runtime asset request.
 */
export const EMBLEM_MINT = '#00ffab';

export function SparkIcon({
  size = 28,
  shade = 'var(--accent)',
  className = '',
}: {
  shade?: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label="Agent"
      viewBox="0 0 24 24"
      className={`emblem inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        color: shade,
      }}
    >
      <path
        fill="currentColor"
        d="M12 1.5 14.65 8.8 22.5 12l-7.85 3.2L12 22.5l-2.65-7.3L1.5 12l7.85-3.2L12 1.5Z"
      />
      <circle cx="12" cy="12" r="2.15" fill="var(--surface)" />
    </svg>
  );
}
