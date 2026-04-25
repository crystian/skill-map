/** UI strings for the PerfHud floating widget. */
export const PERF_HUD_TEXTS = {
  a11y: {
    expand: 'Expand performance HUD',
    collapse: 'Collapse performance HUD',
  },
  units: {
    fps: (n: number) => `${n} fps`,
    ms: (n: number) => `${n}ms`,
    mb: (n: number) => `${n} MB`,
    longTasks: (n: number) => `${n} long`,
    domNodes: (n: number) => `${n} dom`,
    nodes: (visible: number, total: number) => `${visible}/${total} nodes`,
    edges: (n: number) => `${n} edges`,
    cacheAge: (sec: number) => `cache ${sec}s`,
  },
} as const;
