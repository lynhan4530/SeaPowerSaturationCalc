import { describe, expect, it } from 'vitest';
import { parseIni, getValue, getValues, getNumber, getList } from '../ini';

// Ported from SeaPowerDataExtraction/test/ini.test.ts (node:test → vitest).
describe('ini tokenizer', () => {
  it('basic section + key/value', () => {
    const doc = parseIni('[General]\nType=Missile\nTargetType=ASuW\n');
    const general = doc.byName.get('General')!;
    expect(general).toBeTruthy();
    expect(getValue(general, 'Type')).toBe('Missile');
    expect(getValue(general, 'TargetType')).toBe('ASuW');
  });

  it('strips // inline comments and trims', () => {
    const doc = parseIni('[Guidance]\nMaxVelocity=620          // knots\nMaxLaunchRange=22.6      // nm\n');
    const g = doc.byName.get('Guidance')!;
    expect(getValue(g, 'MaxVelocity')).toBe('620');
    expect(getNumber(g, 'MaxVelocity')).toBe(620);
    expect(getNumber(g, 'MaxLaunchRange')).toBe(22.6);
  });

  it('ignores # and ##### line comments', () => {
    const doc = parseIni('############ header ############\n# a note\n[General]\n# inner note\nType=Missile\n');
    expect(doc.sections.length).toBe(1);
    expect(getValue(doc.byName.get('General')!, 'Type')).toBe('Missile');
  });

  it('lines opening with // are comments, not values', () => {
    const doc = parseIni('[General]\n// disabled=Type=Foo\nType=Missile\n');
    const g = doc.byName.get('General')!;
    expect(getValue(g, 'Type')).toBe('Missile');
    expect(g.keys.length).toBe(1);
  });

  it('divider sections are dropped, real dashed ids kept', () => {
    const doc = parseIni('[ ---- CIWS ---- ]\n[AK630]\nMissileInterceptChance=45\n[SPG-62]\nWeaponChannels=1\n');
    expect(doc.byName.has('---- CIWS ----')).toBe(false);
    expect(doc.byName.get('AK630')).toBeTruthy();
    expect(doc.byName.get('SPG-62')).toBeTruthy();
    expect(getNumber(doc.byName.get('AK630')!, 'MissileInterceptChance')).toBe(45);
    expect(getNumber(doc.byName.get('SPG-62')!, 'WeaponChannels')).toBe(1);
  });

  it('=== / ### / *** dividers are dropped too', () => {
    const doc = parseIni('[==========]\n[####]\n[~~~~]\n[Real]\nx=1\n');
    expect(doc.sections.map((s) => s.name)).toEqual(['Real']);
  });

  it('duplicate keys collect into arrays in document order', () => {
    const doc = parseIni('[General]\nAssociatedMagazine=MagA\nAssociatedMagazine=MagB\nAssociatedMagazine=MagC\n');
    const g = doc.byName.get('General')!;
    expect(getValues(g, 'AssociatedMagazine')).toEqual(['MagA', 'MagB', 'MagC']);
    expect(getValue(g, 'AssociatedMagazine')).toBe('MagA');
    expect(g.keys).toEqual(['AssociatedMagazine']);
  });

  it('repeated section header merges, preserving duplicate keys', () => {
    const doc = parseIni('[General]\nx=1\n[Other]\ny=2\n[General]\nx=9\nz=3\n');
    expect(doc.sections.length).toBe(2);
    const g = doc.byName.get('General')!;
    expect(getValues(g, 'x')).toEqual(['1', '9']);
    expect(getValue(g, 'z')).toBe('3');
  });

  it('comma list parsing (AvailableLoadouts)', () => {
    const doc = parseIni('[WeaponSystems]\nAvailableLoadouts=051, 051BF ,052,\n');
    expect(getList(doc.byName.get('WeaponSystems')!, 'AvailableLoadouts')).toEqual(['051', '051BF', '052']);
  });

  it('preamble captures keys before the first section', () => {
    const doc = parseIni('Name=[DEPRECATED] Old Mod\n[General]\nType=Missile\n');
    expect(getValue(doc.preamble, 'Name')).toBe('[DEPRECATED] Old Mod');
  });

  it('CRLF line endings handled', () => {
    const doc = parseIni('[General]\r\nType=Missile\r\n');
    expect(getValue(doc.byName.get('General')!, 'Type')).toBe('Missile');
  });

  it('numbers that are not finite return undefined', () => {
    const doc = parseIni('[X]\na=\nb=notanumber\nc=12\n');
    const x = doc.byName.get('X')!;
    expect(getNumber(x, 'a')).toBeUndefined();
    expect(getNumber(x, 'b')).toBeUndefined();
    expect(getNumber(x, 'c')).toBe(12);
    expect(getNumber(x, 'missing')).toBeUndefined();
  });
});
