const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const normalizeBearing = (deg: number): number => ((deg % 360) + 360) % 360;

type Position = { rangeNm: number; bearingDeg: number };

function toCartesian(rangeNm: number, bearingDeg: number): { x: number; y: number } {
  const r = toRad(bearingDeg);
  return { x: rangeNm * Math.sin(r), y: rangeNm * Math.cos(r) };
}

function fromCartesian(x: number, y: number): Position {
  return {
    rangeNm: Math.sqrt(x * x + y * y),
    bearingDeg: normalizeBearing(toDeg(Math.atan2(x, y))),
  };
}

export function projectPosition(
  startRangeNm: number,
  startBearingDeg: number,
  travelDistanceNm: number,
  travelHeadingDeg: number,
): Position {
  const start = toCartesian(startRangeNm, startBearingDeg);
  const delta = toCartesian(travelDistanceNm, travelHeadingDeg);
  return fromCartesian(start.x + delta.x, start.y + delta.y);
}

export function bearingTo(
  aRangeNm: number,
  aBearingDeg: number,
  bRangeNm: number,
  bBearingDeg: number,
): number {
  const a = toCartesian(aRangeNm, aBearingDeg);
  const b = toCartesian(bRangeNm, bBearingDeg);
  return normalizeBearing(toDeg(Math.atan2(b.x - a.x, b.y - a.y)));
}

export function distance(
  aRangeNm: number,
  aBearingDeg: number,
  bRangeNm: number,
  bBearingDeg: number,
): number {
  const a = toCartesian(aRangeNm, aBearingDeg);
  const b = toCartesian(bRangeNm, bBearingDeg);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}
