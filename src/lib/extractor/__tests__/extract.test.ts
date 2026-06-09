import { describe, expect, it } from 'vitest';
import { MemVfs } from '../vfs';
import { buildNameTables } from '../names';
import { extractPresets } from '../orchestrate';

// End-to-end validation of the browser-side pipeline (MemVfs → enumerate →
// index/merge → parse → cross-link → applyNames), built from an in-memory
// StreamingAssets tree using the real game INI keys. Mirrors the Ticonderoga in
// fixtures/sample-presets.json, plus a mod that overrides one missile to exercise
// source layering / last-writer-wins.

const GAME = 'game/Sea Power_Data/StreamingAssets/original';

const FILES = new Map<string, string>([
  // --- ammunition (base) ---
  [`${GAME}/ammunition/usn_rim-66c.ini`, `[General]
Type=Missile
TargetType=AAW
[Guidance]
GuidanceType=2
MaxVelocity=600
MinLaunchRange=2
MaxLaunchRange=70
[WarheadData]
KillProbability=0.8
`],
  [`${GAME}/ammunition/usn_aim-9x.ini`, `[General]
Type=Missile
TargetType=AAW
[Guidance]
GuidanceType=1
MaxVelocity=1300
MinLaunchRange=0.5
MaxLaunchRange=22
[WarheadData]
KillProbability=0.85
`],
  [`${GAME}/ammunition/usn_mk46.ini`, `[General]
Type=Missile
TargetType=ASW
[Guidance]
GuidanceType=7
MaxVelocity=45
MaxLaunchRange=5.5
`],
  // A non-missile in the same folder must be skipped.
  [`${GAME}/ammunition/usn_5in_round.ini`, `[General]
Type=Projectile
`],

  // --- systems (merged per-section) ---
  [`${GAME}/systems/weapons.ini`, `[MK13]
ModuleType=VLS
ReloadTime=4.5
FireRate=13.33
[AK630]
ModuleType=CIWS
MissileInterceptChance=90
AircraftInterceptChance=95
FireRate=4200
`],
  [`${GAME}/systems/sensors.ini`, `[SPG-62]
Kind=Radar
Type=Targeting
Mode=Illuminate
WeaponChannels=2
MaxRange=90
[SPY-1A]
Kind=Radar
Type=DirectedSearch
Mode=RadioCommand
WeaponChannels=24
MaxRange=370
[SQS-53]
Kind=Sonar
Type=Search
TargetChannels=1
`],

  // --- vessel: Ticonderoga (two SPG-62 terminal directors + SPY-1A) ---
  [`${GAME}/vessels/usn_cg_ticonderoga.ini`, `[General]
UnitType=Vessel
[AI]
Role=AAW,ASW,ASuW
[Physics]
Displacement=9600
MaxForwardVelocity=32
[SensorSystem1]
SystemName=SPY-1A
[SensorSystem5]
SystemName=SPG-62
[SensorSystem6]
SystemName=SPG-62
[WeaponSystems]
NumberOfWeaponSystems=2
AvailableLoadouts=Default
[WeaponSystem1]
Type=Missile
SystemName=MK13
AssociatedSensors=SensorSystem5,SensorSystem6,SensorSystem1
AssociatedMagazine=MagTico
[WeaponSystem2]
Type=CIWS
SystemName=AK630
[MagTico]
NumberOfAmmunitionTypes=2
Ammunition1=usn_rim-66c
Ammunition1_Count=32
Ammunition2=usn_aim-9x
Ammunition2_Count=8
`],

  // --- localization ---
  [`${GAME}/language_en/ammunition_names.ini`, `[AmmunitionNames]
usn_rim-66c=RIM-66C,SM-2MR,SAM/ASuW,The Standard Missile
usn_aim-9x=AIM-9X,Sidewinder,IR AAM,The Sidewinder
`],
  [`${GAME}/language_en/vessel_names.ini`, `[usn_cg_ticonderoga]
Default=Ticonderoga-class,Ticonderoga
`],
  [`${GAME}/language_en/systemgroups.ini`, `[SystemNames]
MK13=MK 13
AK630=AK-630
SPG-62=SPG-62
SPY-1A=SPY-1A
`],

  // --- a workshop mod that overrides RIM-66C's Pk (0.8 → 0.9) ---
  ['mods/9999/_info.ini', `[General]
Name=Test Mod
`],
  ['mods/9999/ammunition/usn_rim-66c.ini', `[General]
Type=Missile
TargetType=AAW
[Guidance]
GuidanceType=2
MaxVelocity=600
MinLaunchRange=2
MaxLaunchRange=70
[WarheadData]
KillProbability=0.9
`],
]);

function run() {
  const vfs = new MemVfs(FILES);
  const names = buildNameTables({
    ammunition: vfs.readText(`${GAME}/language_en/ammunition_names.ini`),
    vessels: vfs.readText(`${GAME}/language_en/vessel_names.ini`),
    systems: vfs.readText(`${GAME}/language_en/systemgroups.ini`),
  });
  return extractPresets(vfs, {
    gamePath: 'game',
    modsPath: 'mods',
    loadOrder: null,
    names,
    gameVersion: '0.7.10',
  });
}

describe('extractPresets — end-to-end through MemVfs', () => {
  it('emits missiles, skips non-missiles, applies localized names', () => {
    const { presets } = run();
    expect(presets.missiles.map((m) => m.id)).toEqual(['usn_aim-9x', 'usn_mk46', 'usn_rim-66c']);

    const sam = presets.missiles.find((m) => m.id === 'usn_rim-66c')!;
    expect(sam.guidance).toBe('SARH');
    expect(sam.role).toBe('AAW');
    expect(sam.speedKnots).toBe(600);
    expect(sam.maxRangeNm).toBe(70);
    expect(sam.minRangeNm).toBe(2);
    expect(sam.name).toBe('RIM-66C'); // localized
    expect(sam.nickname).toBe('SM-2MR');
    expect(sam.category).toBe('SAM/ASuW');
  });

  it('a mod overrides the base missile (last-writer-wins) with a collision warning', () => {
    const { presets, warnings } = run();
    const sam = presets.missiles.find((m) => m.id === 'usn_rim-66c')!;
    expect(sam.killProbability).toBe(0.9); // mod value, not base 0.8
    expect(sam.source).toBe('9999');
    expect(warnings.some((w) => w.includes('collision: ammunition/usn_rim-66c'))).toBe(true);
    expect(presets.sources.map((s) => s.id)).toEqual(['base', '9999']);
    expect(presets.sources.find((s) => s.id === '9999')!.name).toBe('Test Mod');
  });

  it('parses launchers and illuminators, skipping channel-less sensors', () => {
    const { presets } = run();
    expect(presets.launchers.map((l) => l.id)).toEqual(['AK630', 'MK13']);
    const mk13 = presets.launchers.find((l) => l.id === 'MK13')!;
    expect(mk13.name).toBe('MK 13'); // localized
    expect(mk13.reloadTimeS).toBe(4.5);
    expect(mk13.fireRatePerMin).toBe(13.33);
    expect(presets.launchers.find((l) => l.id === 'AK630')!.missileInterceptChance).toBe(90);

    // SQS-53 has no WeaponChannels → excluded.
    expect(presets.illuminators.map((i) => i.id)).toEqual(['SPG-62', 'SPY-1A']);
    expect(presets.illuminators.find((i) => i.id === 'SPG-62')!.maxRangeNm).toBe(48.6); // 90 km
  });

  it('cross-links the Ticonderoga: cap = 4, mounts resolved, ammo aggregated', () => {
    const { presets } = run();
    const ship = presets.ships.find((s) => s.id === 'usn_cg_ticonderoga')!;
    expect(ship.name).toBe('Ticonderoga-class'); // localized
    expect(ship.nickname).toBe('Ticonderoga');
    // Two SPG-62 terminal directors × 2 channels = 4; SPY-1A (DirectedSearch) excluded.
    expect(ship.weaponChannels).toBe(4);
    expect(ship.directors.some((d) => d.illuminatorId === 'SPY-1A')).toBe(true);
    expect(ship.mounts.map((m) => [m.launcherId, m.resolved])).toEqual([
      ['MK13', true],
      ['AK630', true],
    ]);
    const dflt = ship.loadouts.find((l) => l.name === 'Default')!;
    expect(dflt.ammo.map((a) => [a.ammoId, a.count, a.isMissile])).toEqual([
      ['usn_aim-9x', 8, true],
      ['usn_rim-66c', 32, true],
    ]);
  });
});
