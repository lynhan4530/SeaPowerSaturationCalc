import { describe, expect, it } from 'vitest';
import { parseIni } from '../ini';
import { parseMissile } from '../parsers/ammunition';
import { parseLauncher } from '../parsers/weapons';
import { parseIlluminator } from '../parsers/sensors';
import { parseVessel, type VesselLinkContext } from '../parsers/vessels';

// Ported from SeaPowerDataExtraction/test/parsers.test.ts (node:test → vitest).
describe('parseMissile', () => {
  it('decodes guidance, role, sea-skimming, ECCM, Pk', () => {
    const doc = parseIni(`[General]
Type=Missile
TargetType=ASuW
[Guidance]
GuidanceType=3
MaxVelocity=620
MinLaunchRange=6
MaxLaunchRange=35
SeaSkimmingAlt=33
SeekerActiveRange=20
AntiCountermeasuresBonus=0.2
AntiJammerBonus=0.05
[WarheadData]
KillProbability=0.85
[SensorData]
RCS=0.25
`);
    const m = parseMissile(doc, 'fr_am-39', 'base')!;
    expect(m).toBeTruthy();
    expect(m.role).toBe('ASuW');
    expect(m.guidance).toBe('ARH');
    expect(m.speedKnots).toBe(620);
    expect(m.maxRangeNm).toBe(35);
    expect(m.minRangeNm).toBe(6);
    expect(m.seaSkimming).toBe(true);
    expect(m.seaSkimmingAltFt).toBe(33);
    expect(m.rcs).toBe(0.25);
    expect(m.antiJammerBonus).toBe(0.05);
    expect(m.killProbability).toBe(0.85);
  });

  it('decodes missing killProbability as null', () => {
    const doc = parseIni('[General]\nType=Missile\nTargetType=AAW\n');
    expect(parseMissile(doc, 'usn_rim-7', 'base')!.killProbability).toBeNull();
  });

  it('returns null for non-missile ammo', () => {
    const doc = parseIni('[General]\nType=Projectile\n');
    expect(parseMissile(doc, 'gun_round', 'base')).toBeNull();
  });

  it('maps unknown guidance code to Unknown', () => {
    const doc = parseIni('[General]\nType=Missile\n[Guidance]\nGuidanceType=42\n');
    expect(parseMissile(doc, 'x', 'base')!.guidance).toBe('Unknown');
  });
});

describe('parseLauncher', () => {
  it('reads CIWS Pk and rate fields', () => {
    const doc = parseIni(`[AK630]
MissileInterceptChance=45
AircraftInterceptChance=70
FireRate=4000
ReloadTime=1800
HorizontalDegreesPerSecond=70
ModuleType=CIWS
`);
    const l = parseLauncher(doc.byName.get('AK630')!, 'base')!;
    expect(l.kind).toBe('CIWS');
    expect(l.missileInterceptChance).toBe(45);
    expect(l.fireRatePerMin).toBe(4000);
    expect(l.reloadTimeS).toBe(1800);
  });

  it('defaults kind to Unknown without ModuleType', () => {
    const doc = parseIni('[NotALauncher]\nFoo=1\n');
    expect(parseLauncher(doc.byName.get('NotALauncher')!, 'base')!.kind).toBe('Unknown');
  });
});

describe('parseIlluminator', () => {
  it('requires WeaponChannels and converts km->nm', () => {
    const doc = parseIni(`[SPG-62]
Kind=Radar
Type=Targeting
Mode=Illuminate
WeaponChannels=1
TargetChannels=1
MaxRange=185.2
`);
    const i = parseIlluminator(doc.byName.get('SPG-62')!, 'base')!;
    expect(i.weaponChannels).toBe(1);
    expect(i.maxRangeKm).toBe(185.2);
    expect(i.maxRangeNm).toBe(100); // 185.2 / 1.852
  });

  it('skips sensors without WeaponChannels', () => {
    const doc = parseIni('[SearchOnly]\nKind=Radar\nType=Search\nTargetChannels=20\n');
    expect(parseIlluminator(doc.byName.get('SearchOnly')!, 'base')).toBeNull();
  });
});

// --- Vessels + cross-linking -------------------------------------------------

const SHIP_INI = `[General]
UnitType=Vessel
[AI]
Role=AAW,ASW
[Physics]
Displacement=4500
MaxForwardVelocity=33
[SensorSystems]
NumberOfSensorSystems=4
[SensorSystem2]
Type=Radar
SystemName=SPY-1A
[SensorSystem5]
Type=Radar
SystemName=SPG-51
[SensorSystem6]
Type=Radar
SystemName=SPG-51
[SensorSystem7]
Type=Radar
SystemName=MK68_GFCS
[WeaponSystems]
NumberOfWeaponSystems=3
AvailableLoadouts=Default,Late
[WeaponSystem1]
Type=Missile
SystemName=MK13
AssociatedSensors=SensorSystem5,SensorSystem6,SensorSystem2
AssociatedMagazine=MagDefault
[WeaponSystem1Late]
Type=Missile
SystemName=MK13
AssociatedSensors=SensorSystem5,SensorSystem6,SensorSystem2
AssociatedMagazine=MagLate
[WeaponSystem2]
Type=Gun
SystemName=MK42
AssociatedSensors=SensorSystem7
[WeaponSystem3]
Type=Missile
SystemName=ASROC
Ammunition=usn_rur-5
NumberOfContainers=8
[MagDefault]
NumberOfAmmunitionTypes=2
Ammunition1=usn_rim-66b
Ammunition1_Count=34
Ammunition2=usn_rgm-84a
Ammunition2_Count=6
[MagLate]
NumberOfAmmunitionTypes=1
Ammunition1=usn_rim-66e
Ammunition1_Count=40
`;

function shipCtx(): VesselLinkContext {
  return {
    illuminators: new Map([
      ['SPG-51', { type: 'Targeting', mode: 'Illuminate', weaponChannels: 1, maxRangeNm: 90 }],
      // A search radar with guidance channels (Aegis-style): must NOT feed the cap.
      ['SPY-1A', { type: 'DirectedSearch', mode: 'Illuminate', weaponChannels: 24, maxRangeNm: 240 }],
    ]),
    launcherIds: new Set(['MK13', 'MK42', 'ASROC']),
    missileIds: new Set(['usn_rim-66b', 'usn_rim-66e', 'usn_rgm-84a', 'usn_rur-5']),
  };
}

describe('parseVessel', () => {
  it('reads identity, mounts, and cross-links launchers', () => {
    const ship = parseVessel(parseIni(SHIP_INI), 'usn_ddg_test', 'base', shipCtx())!;
    expect(ship.unitType).toBe('Vessel');
    expect(ship.role).toBe('AAW,ASW');
    expect(ship.displacementTons).toBe(4500);
    expect(ship.maxSpeedKnots).toBe(33);
    expect(ship.mounts.length).toBe(3);
    expect(ship.mounts.map((m) => [m.launcherId, m.resolved])).toEqual([
      ['MK13', true],
      ['MK42', true],
      ['ASROC', true],
    ]);
  });

  it('resolves launchers with naming drift/casing issues', () => {
    const customCtx: VesselLinkContext = {
      illuminators: new Map(),
      launcherIds: new Set(['MK36', 'Sylver_A50', 'eu_NSM_quad_launcher', 'GJB5860-2006']),
      missileIds: new Set<string>(),
    };
    const shipIni = `[General]
UnitType=Vessel
[WeaponSystems]
NumberOfWeaponSystems=4
[WeaponSystem1]
Type=Missile
SystemName=Mk36
[WeaponSystem2]
Type=Missile
SystemName=Sylver50
[WeaponSystem3]
Type=Missile
SystemName=NSM_quad_launcher
[WeaponSystem4]
Type=Missile
SystemName=GJB_5860-2006
`;
    const ship = parseVessel(parseIni(shipIni), 'test_ship', 'base', customCtx)!;
    expect(ship.mounts.length).toBe(4);
    expect(ship.mounts.map((m) => [m.launcherId, m.resolved])).toEqual([
      ['MK36', true],
      ['Sylver_A50', true],
      ['eu_NSM_quad_launcher', true],
      ['GJB5860-2006', true],
    ]);
  });

  it('cap counts only Type=Targeting illuminators', () => {
    const ship = parseVessel(parseIni(SHIP_INI), 'usn_ddg_test', 'base', shipCtx())!;
    expect(ship.directors.map((d) => d.sensorSystem)).toEqual([
      'SensorSystem2',
      'SensorSystem5',
      'SensorSystem6',
    ]);
    expect(ship.directors.some((d) => d.illuminatorId === 'SPY-1A')).toBe(true);
    expect(ship.weaponChannels).toBe(2);
  });

  it('resolves per-loadout ammo from magazines and direct binds', () => {
    const ship = parseVessel(parseIni(SHIP_INI), 'usn_ddg_test', 'base', shipCtx())!;
    const byName = new Map(ship.loadouts.map((l) => [l.name, l]));
    expect(byName.get('Default')!.ammo.map((a) => [a.ammoId, a.count])).toEqual([
      ['usn_rgm-84a', 6],
      ['usn_rim-66b', 34],
      ['usn_rur-5', 8],
    ]);
    expect(byName.get('Default')!.ammo.every((a) => a.isMissile)).toBe(true);
    expect(byName.get('Late')!.ammo.map((a) => [a.ammoId, a.count])).toEqual([
      ['usn_rim-66e', 40],
      ['usn_rur-5', 8],
    ]);
  });

  it('returns null when there is no [WeaponSystems]', () => {
    const doc = parseIni('[General]\nUnitType=Vessel\n[Physics]\nDisplacement=900\n');
    expect(parseVessel(doc, 'civ_tugboat', 'base', shipCtx())).toBeNull();
  });
});
