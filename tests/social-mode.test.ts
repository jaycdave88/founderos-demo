import { describe, expect, test } from 'vitest';
import { socialControls, socialHeaderLabel } from '@/lib/social-mode';

describe('social preview quarantine', () => {
  test('defaults to preview with external publishing unavailable', () => {
    expect(socialControls({})).toEqual({ mode: 'preview', publishEnabled: false, canPublish: false });
  });

  test('preview mode wins even if the lower-level publishing flag is set', () => {
    expect(socialControls({ SOCIAL_MODE: 'preview', SOCIAL_PUBLISH_ENABLED: '1' }).canPublish).toBe(false);
    expect(socialHeaderLabel(false, socialControls({ SOCIAL_MODE: 'preview' }))).toBe('demo preview · publishing off');
  });

  test('live analytics do not imply permission to publish', () => {
    const controls = socialControls({ SOCIAL_MODE: 'preview', SOCIAL_PUBLISH_ENABLED: '0' });
    expect(socialHeaderLabel(true, controls)).toBe('live analytics · publishing off');
  });

  test('requires production mode and the explicit enable flag together', () => {
    const guarded = socialControls({ SOCIAL_MODE: 'production', SOCIAL_PUBLISH_ENABLED: '0' });
    expect(guarded.canPublish).toBe(false);
    expect(socialHeaderLabel(false, guarded)).toBe('no live data · publishing off');
    expect(socialControls({ SOCIAL_MODE: 'production', SOCIAL_PUBLISH_ENABLED: '1' }).canPublish).toBe(true);
  });
});
