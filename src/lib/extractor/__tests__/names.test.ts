import { describe, expect, it } from 'vitest';
import { parseAmmunitionNames, parseVesselNames, parseSystemNames } from '../names';

// Ported from SeaPowerDataExtraction/test/names.test.ts (node:test → vitest).
describe('parseAmmunitionNames', () => {
  it('name, nickname, category', () => {
    const m = parseAmmunitionNames(
      '[AmmunitionNames]\nusn_rim-66c=RIM-66C,SM-2MR,SAM/ASuW,The RIM-66C Standard Missile\n',
    );
    const e = m.get('usn_rim-66c')!;
    expect(e.name).toBe('RIM-66C');
    expect(e.nickname).toBe('SM-2MR');
    expect(e.category).toBe('SAM/ASuW');
  });

  it('empty nickname → null', () => {
    const e = parseAmmunitionNames('[AmmunitionNames]\nsome_missile=Name,,Cat,desc\n').get('some_missile')!;
    expect(e.nickname).toBeNull();
    expect(e.category).toBe('Cat');
  });

  it('description with commas not split into fields', () => {
    const e = parseAmmunitionNames(
      '[AmmunitionNames]\nsome_missile=Name,Nick,Cat,desc part1,desc part2,desc part3\n',
    ).get('some_missile')!;
    expect(e.name).toBe('Name');
    expect(e.nickname).toBe('Nick');
    expect(e.category).toBe('Cat');
  });

  it('missing section → empty map', () => {
    expect(parseAmmunitionNames('[OtherSection]\nkey=val\n').size).toBe(0);
  });
});

describe('parseVesselNames', () => {
  it('name and nickname from Default', () => {
    const e = parseVesselNames('[usn_cg_ticonderoga]\nDefault=Ticonderoga-class,Ticonderoga\n').get(
      'usn_cg_ticonderoga',
    )!;
    expect(e.name).toBe('Ticonderoga-class');
    expect(e.nickname).toBe('Ticonderoga');
    expect(e.category).toBeNull();
  });

  it('section without Default is skipped', () => {
    expect(parseVesselNames('[some_ship]\nType=Destroyer\n').size).toBe(0);
  });

  it('simple Type → category', () => {
    expect(parseVesselNames('[some_raft]\nDefault=Raft Ship,\nType=Raft\n').get('some_raft')!.category).toBe(
      'Raft',
    );
  });

  it('Type=M,Mine → last comma-field as category', () => {
    expect(parseVesselNames('[some_mine]\nDefault=Mine Layer,\nType=M,Mine\n').get('some_mine')!.category).toBe(
      'Mine',
    );
  });

  it('empty nickname → null', () => {
    expect(parseVesselNames('[hull]\nDefault=Full Name,\n').get('hull')!.nickname).toBeNull();
  });
});

describe('parseSystemNames', () => {
  it('plain id=Name from [SystemNames]', () => {
    expect(parseSystemNames('[SystemNames]\nMK13=MK 13\n').get('MK13')).toBe('MK 13');
  });

  it('id=Name|Description → name only', () => {
    expect(parseSystemNames('[SystemNames]\nSPG-62=SPG-62|The AN/SPG-62 illuminator\n').get('SPG-62')).toBe(
      'SPG-62',
    );
  });

  it('id=Name|Nickname|Description (3-field gun form) → name only', () => {
    expect(
      parseSystemNames('[SystemNames]\nMk8=4.5" Mk 8|4.5" Mk 8 Naval Gun|The 4.5" Mk 8 replaced…\n').get('Mk8'),
    ).toBe('4.5" Mk 8');
  });

  it('reads both sections; [SystemNames] wins on collision', () => {
    const m = parseSystemNames(
      '[LanguageResources]\nSG_CIC=Combat Information Center\nMK13=stale\n[SystemNames]\nMK13=MK 13\n',
    );
    expect(m.get('SG_CIC')).toBe('Combat Information Center');
    expect(m.get('MK13')).toBe('MK 13');
  });

  it('missing sections → empty map', () => {
    expect(parseSystemNames('[OtherSection]\nkey=val\n').size).toBe(0);
  });
});
