/** Unit conversions. Missiles use nm/knots/feet; sensors use km/meters.
 *  Vendored verbatim from the SeaPowerDataExtraction parser (src/units.ts). */

const NM_PER_KM = 1 / 1.852;

export function kmToNm(km: number): number {
  // Round to 1 decimal; presets don't need more precision than the game shows.
  return Math.round(km * NM_PER_KM * 10) / 10;
}
