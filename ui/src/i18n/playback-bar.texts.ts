/** UI strings for the Live lens replay transport bar (`sm-playback-bar`). */
export const PLAYBACK_BAR_TEXTS = {
  exit: 'Exit replay',
  play: 'Play',
  pause: 'Pause',
  stepBack: 'Previous event',
  stepForward: 'Next event',
  /** Director camera toggle; label + tooltip name the CURRENT state. */
  directorOn: 'Director camera on: the replay follows each step up close',
  directorOff: 'Director camera off: the replay keeps the whole route in frame',
  scrubber: 'Replay position',
  /** `k / N` progress readout. */
  counter: (current: number, total: number): string => `${current} / ${total}`,
  /** Wall-clock time (local) the cursor event executed at. */
  captionTime: (hh: string, mm: string, ss: string): string => `${hh}:${mm}:${ss}`,
  timeTooltip: 'When this step executed',
  /** Elapsed from the first recorded event to the cursor event. */
  captionElapsed: (clock: string): string => `(${clock})`,
  elapsedTooltip: 'Elapsed since the start of the session',
  emptyTape: 'Nothing recorded yet',
  trimmedTape: 'Oldest events trimmed from the tape',
  scopeTooltip: 'Replaying only this slice of the recording',
  deleteRecording: 'Clear this tape (saved session files stay)',
  /** tape-session replays: the trash drops only the watched session. */
  deleteSession: 'Remove this session from this browser (its saved file stays)',
  caption: {
    start: (name: string, detail: string | undefined): string =>
      detail === undefined ? `run ${name}` : `${detail} ${name}`,
    end: (name: string): string => `done ${name}`,
    ownerEnd: 'execution context ended',
    sessionEnd: 'session ended',
    turnEnd: 'turn ended',
    /** Node-less custody frames with no finer story (never blank). */
    other: 'session signal',
    /** An empty parent is the session context itself spawning. */
    spawn: (parent: string, child: string, phase: string): string => {
      if (phase === 'end') return parent === '' ? `finished ${child}` : `${parent} finished ${child}`;
      return parent === '' ? `spawned ${child}` : `${parent} spawned ${child}`;
    },
  },
} as const;
