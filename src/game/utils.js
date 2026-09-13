export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function distanceSq(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;

  return dx * dx + dy * dy;
}

export function normalize(dx, dy) {
  const length = Math.hypot(dx, dy) || 1;

  return {
    x: dx / length,
    y: dy / length,
  };
}

export function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;

  const lengthSq = abx * abx + aby * aby;

  if (lengthSq === 0) {
    return distance(px, py, ax, ay);
  }

  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSq, 0, 1);

  const closestX = ax + abx * t;
  const closestY = ay + aby * t;

  return distance(px, py, closestX, closestY);
}

export function isPointNearPath(x, y, path, padding = 26) {
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];

    if (pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y) <= padding) {
      return true;
    }
  }

  return false;
}

export function formatNumber(value) {
  return Math.floor(value).toLocaleString("en-IN");
}
