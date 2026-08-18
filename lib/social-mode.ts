export type SocialControls = {
  mode: 'preview' | 'production';
  publishEnabled: boolean;
  canPublish: boolean;
};

/** Two independent switches are required before external publishing exists. */
export function socialControls(env: Record<string, string | undefined>): SocialControls {
  const mode = env.SOCIAL_MODE === 'production' ? 'production' : 'preview';
  const publishEnabled = env.SOCIAL_PUBLISH_ENABLED === '1';
  return { mode, publishEnabled, canPublish: mode === 'production' && publishEnabled };
}

export function socialHeaderLabel(liveAnalytics: boolean, controls: SocialControls): string {
  if (!liveAnalytics) {
    if (controls.mode === 'preview') return 'demo preview · publishing off';
    return controls.canPublish ? 'no live data · publishing armed' : 'no live data · publishing off';
  }
  return controls.canPublish ? 'live · publishing on' : 'live analytics · publishing off';
}
