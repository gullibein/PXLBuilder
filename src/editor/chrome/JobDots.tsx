import { useJobs } from '../ai/jobs';

/**
 * Above a button whose prompt card is closed: bouncing dots while its AI
 * prompt runs, or a badge when one finished and hasn't been looked at (like
 * the dots and badges above objects on the level).
 */
export function JobDots({ keys, open }: { keys: string[]; open: boolean }) {
  const jobs = useJobs((s) => s.jobs);
  if (open) return null;
  const mine = keys.map((k) => jobs[k]).filter((j) => !!j);
  if (mine.some((j) => j.phase === 'working')) {
    return (
      <span className="job-dots" data-testid="job-dots" aria-label="The AI is working on it" title="The AI is working on it">
        <i />
        <i />
        <i />
      </span>
    );
  }
  const waiting = mine.find((j) => !j.seen);
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
