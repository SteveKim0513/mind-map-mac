import { describe, it, expect } from 'vitest';
import { parseChangelog, isNewer } from './changelog';

const SAMPLE = `# Changelog

intro line, ignored

## [0.5.2] - 2026-06-15
### 새 기능
- A
- B

## [0.5.1] - 2026-06-14
### 버그 수정
- C

## [0.4.0] - 2026-06-12
- D
`;

describe('parseChangelog', () => {
  it('parses versions newest-first with date + body', () => {
    const r = parseChangelog(SAMPLE);
    expect(r.map((x) => x.version)).toEqual(['0.5.2', '0.5.1', '0.4.0']);
    expect(r[0].date).toBe('2026-06-15');
    expect(r[0].body).toContain('### 새 기능');
    expect(r[0].body).toContain('- A');
    expect(r[0].body).not.toContain('## ['); // body excludes the next header
  });
  it('ignores the intro before the first version', () => {
    expect(parseChangelog(SAMPLE)[0].body).not.toContain('intro line');
  });
  it('returns [] for changelog with no versions', () => {
    expect(parseChangelog('# Changelog\n\nnothing yet')).toEqual([]);
  });
});

describe('isNewer', () => {
  it('compares semver parts', () => {
    expect(isNewer('0.5.2', '0.5.1')).toBe(true);
    expect(isNewer('0.5.1', '0.5.2')).toBe(false);
    expect(isNewer('0.5.0', '0.5.0')).toBe(false);
    expect(isNewer('0.6.0', '0.5.9')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });
});
