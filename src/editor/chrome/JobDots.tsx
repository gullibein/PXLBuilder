import { useJobs } from '../ai/jobs';

/**
 * Above a button whose prompt card is closed: bouncing dots while its AI
 * prompt runs, or a badge when one finished and hasn't been looked at (like
 * the dots and badges above objects on the level).
 */
export function JobDots({ keys = [], prefixes = [], workingOnly = false, open, below = false }: { keys?: string[]; open: boolean; below?: boolean; prefixes?: string[]; workingOnly?: boolean }) {
  const jobs = useJobs((s) => s.jobs);
  if (open) return null;
  // (prefixes: every prompt of a kind, "sound:" for all the sound prompts, wherever they were asked.)
  const mine = Object.values(jobs).filter((j) => keys.includes(j.key) || prefixes.some((p) => j.key.startsWith(p)));
  if (mine.some((j) => j.phase === 'working')) {
    return (
      <span className={`job-dots${below ? ' below' : ''}`} data-testid="job-dots" aria-label="The AI is working on it" title="The AI is working on it">
        <i />
        <i />
        <i />
      </span>
    );
  }
  // (workingOnly: only while it works; the answer waits on the card it was asked in.)
  const waiting = workingOnly ? undefined : mine.find((j) => !j.seen);
  if (waiting) {
    const error = waiting.outcome?.status === 'error';
    return (
      <span className={`job-badge${error ? ' error' : ''}`} data-testid="job-badge" title="The AI finished: open it to see the answer">
        {error ? '!' : '✦'}
      </span>
    );
  }
  return null;
}
