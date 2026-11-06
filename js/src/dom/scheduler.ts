// One requestAnimationFrame loop for every chart on the page. It stops when nothing moves, so a
// settled dashboard costs nothing; charts that are off screen are skipped until they come back.

export interface Animated {
  readonly visible: boolean;
  /** Advance and draw one frame; return true while still moving. */
  tick(now: number, dt: number): boolean;
}

const awake = new Set<Animated>();
let raf = 0, last = 0;

function loop(now: number) {
  raf = 0;
  const dt = last ? Math.min(0.1, Math.max(0.001, (now - last) / 1000)) : 1 / 60;
  last = now;
  for (const c of awake) {
    if (!c.visible) { awake.delete(c); continue; }
    let moving = false;
    try { moving = c.tick(now, dt); } catch (e) { awake.delete(c); throw e; }
    if (!moving) awake.delete(c);
  }
  if (awake.size) raf = requestAnimationFrame(loop);
  else last = 0;
}

export function wake(c: Animated) {
  awake.add(c);
  if (!raf) raf = requestAnimationFrame(loop);
}

export function sleep(c: Animated) { awake.delete(c); }

/** Charts currently animating (for tests and the perf page). */
export const awakeCount = () => awake.size;
