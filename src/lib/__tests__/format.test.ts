import { describe, expect, it } from 'vitest';
import { buildDisplayNames } from '../format';

describe('buildDisplayNames', () => {
  it('leaves unique names unchanged', () => {
    const m = buildDisplayNames([
      { id: 'a', name: 'Slava-class' },
      { id: 'b', name: 'Ticonderoga-class' },
    ]);
    expect(m.get('a')).toBe('Slava-class');
    expect(m.get('b')).toBe('Ticonderoga-class');
  });

  it('suffixes duplicates with " #N" in list order', () => {
    const m = buildDisplayNames([
      { id: 'a', name: 'Ticonderoga-class' },
      { id: 'b', name: 'Ticonderoga-class' },
      { id: 'c', name: 'Ticonderoga-class' },
    ]);
    expect(m.get('a')).toBe('Ticonderoga-class #1');
    expect(m.get('b')).toBe('Ticonderoga-class #2');
    expect(m.get('c')).toBe('Ticonderoga-class #3');
  });

  it('only disambiguates the colliding names, not the unique ones', () => {
    const m = buildDisplayNames([
      { id: 'a', name: 'Slava-class' },
      { id: 'b', name: 'Ticonderoga-class' },
      { id: 'c', name: 'Slava-class' },
    ]);
    expect(m.get('a')).toBe('Slava-class #1');
    expect(m.get('c')).toBe('Slava-class #2');
    expect(m.get('b')).toBe('Ticonderoga-class');
  });

  it('returns an empty map for no items', () => {
    expect(buildDisplayNames([]).size).toBe(0);
  });
});
