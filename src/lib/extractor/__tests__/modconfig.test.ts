import { describe, expect, it } from 'vitest';
import { parseLoadOrder } from '../modconfig';

// Ported from SeaPowerDataExtraction/test/modconfig.test.ts (node:test → vitest).
// The fs/os `defaultModConfigPath` test is dropped — it isn't part of the
// browser build (usersettings.ini lives outside the picked folder).
describe('parseLoadOrder', () => {
  it('enabled subset with non-contiguous order, ascending', () => {
    const text = [
      '[LoadOrder]',
      'Mod1Directory=3380210757,True',
      'Mod3Directory=3606134711,True',
      'Mod5Directory=DisabledMod,False',
      'Mod12Directory=3491248180,True',
      'NumberOfModFiles=12',
    ].join('\n');
    const entries = parseLoadOrder(text)!;
    expect(entries.length).toBe(4);
    expect(entries.map((e) => e.order)).toEqual([1, 3, 5, 12]);
    expect(entries.map((e) => e.id)).toEqual(['3380210757', '3606134711', 'DisabledMod', '3491248180']);
    expect(entries.map((e) => e.enabled)).toEqual([true, true, false, true]);
  });

  it('local mod folder names (non-numeric) are kept', () => {
    const entries = parseLoadOrder('[LoadOrder]\nMod1Directory=AI Doctrine Overhaul,False\nNumberOfModFiles=1\n')!;
    expect(entries[0]?.id).toBe('AI Doctrine Overhaul');
    expect(entries[0]?.enabled).toBe(false);
  });

  it('NumberOfModFiles and stray keys ignored', () => {
    const entries = parseLoadOrder('[LoadOrder]\nNumberOfModFiles=5\nSomethingElse=99\nMod2Directory=abc,True\n')!;
    expect(entries.length).toBe(1);
    expect(entries[0]?.id).toBe('abc');
    expect(entries[0]?.order).toBe(2);
  });

  it('case-insensitive enable flag', () => {
    const entries = parseLoadOrder('[LoadOrder]\nMod1Directory=a,TRUE\nMod2Directory=b,false\nMod3Directory=c,True\n')!;
    expect(entries.map((e) => e.enabled)).toEqual([true, false, true]);
  });

  it('missing [LoadOrder] section → undefined', () => {
    expect(parseLoadOrder('[VideoSettings]\nScreenWidth=1920\n')).toBeUndefined();
  });

  it('section present but no Mod<N>Directory entries → undefined', () => {
    expect(parseLoadOrder('[LoadOrder]\nNumberOfModFiles=0\n')).toBeUndefined();
  });

  it('empty / malformed body → undefined', () => {
    expect(parseLoadOrder('')).toBeUndefined();
    expect(parseLoadOrder('not an ini at all')).toBeUndefined();
  });
});
