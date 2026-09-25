/**
 * Timeline correction for a separate lower-bitrate audio-capable video.
 * Small drift is corrected smoothly; larger drift and explicit seeking use an
 * immediate seek so the tracks do not stay noticeably out of sync.
 */
export interface AudioSyncDecision {
  seekTo: number | null;
  playbackRate: number;
}

export const planBackupAudioSync = ({
  primaryTime,
  backupTime,
  primaryRate,
  backupDuration,
  force = false,
}: {
  primaryTime: number;
  backupTime: number;
  primaryRate: number;
  backupDuration?: number;
  force?: boolean;
}): AudioSyncDecision => {
  const baseRate = Number.isFinite(primaryRate) && primaryRate > 0 ? primaryRate : 1;
  const primary = Number.isFinite(primaryTime) ? Math.max(0, primaryTime) : 0;
  const target = Number.isFinite(backupDuration) && (backupDuration ?? 0) > 0
    ? Math.min(primary, Math.max(0, (backupDuration as number) - 0.05))
    : primary;
  const current = Number.isFinite(backupTime) ? Math.max(0, backupTime) : 0;
  const drift = target - current;
  if (force || Math.abs(drift) >= 0.65) {
    return { seekTo: target, playbackRate: baseRate };
  }
  if (Math.abs(drift) < 0.085) {
    return { seekTo: null, playbackRate: baseRate };
  }
  // Limit corrections to 4%, and do not nudge while changing playback speed.
  return {
    seekTo: null,
    playbackRate: Number((baseRate * (drift > 0 ? 1.04 : 0.96)).toFixed(4)),
  };
};
