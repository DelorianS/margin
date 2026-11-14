export function jobProgressText(job, at = Date.now()) {
  const parts = [job.message];
  if (job.type === 'import' && job.phaseTotal) parts.push(`${(job.phase === 'analysis' ? job.analyzed : job.downloaded) || 0}/${job.phaseTotal} ${job.phase === 'analysis' ? 'analysed' : 'downloaded'}`);
  if (job.status === 'running' && job.phase === 'analysis' && job.chapterStartedAt) {
    const seconds = Math.max(0, Math.floor((at - job.chapterStartedAt) / 1000));
    parts.push(seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);
  }
  return parts.filter(Boolean).join(' · ');
}
