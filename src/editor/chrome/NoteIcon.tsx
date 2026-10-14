/** A music note. */
export function NoteIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 12.2V3.2l7-1.4v8.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <ellipse cx="4.3" cy="12.4" rx="2" ry="1.6" fill="currentColor" />
      <ellipse cx="11.3" cy="10.6" rx="2" ry="1.6" fill="currentColor" />
    </svg>
  );
}
