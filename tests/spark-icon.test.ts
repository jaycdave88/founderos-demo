import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(join(process.cwd(), 'components/SparkIcon.tsx'), 'utf8');

describe('agent emblem', () => {
  test('is a self-contained vector with no missing runtime asset', () => {
    expect(source).toContain('<svg');
    expect(source).toContain('fill="currentColor"');
    expect(source).not.toMatch(/url\s*\(/i);
    expect(source).not.toMatch(/vantage-emblem\.png/i);
  });
});
