import { ConfigService } from '@nestjs/config';
import path from 'path';

export interface EmailAssets {
  badge: string | null;
  original: string | null;
  stacked: string | null;
  monochrome: string | null;
}

export function getLocalEmailAssets() {
  return {
    badge: path.join(__dirname, 'assets', 'notaryday-icon-badge.png'),
    original: path.join(__dirname, 'assets', 'notaryday-original.png'),
    stacked: path.join(__dirname, 'assets', 'notaryday-stacked.png'),
    monochrome: path.join(__dirname, 'assets', 'notaryday-monochrome.png'),
  };
}

export function getEmailAssets(config: ConfigService): EmailAssets {
  const base = (config.get<string>('EMAIL_ASSET_BASE_URL') ?? '').replace(
    /\/$/,
    '',
  );
  if (!base) {
    return { badge: null, original: null, stacked: null, monochrome: null };
  }

  return {
    badge: `${base}/notaryday-icon-badge.png`,
    original: `${base}/notaryday-original.png`,
    stacked: `${base}/notaryday-stacked.png`,
    monochrome: `${base}/notaryday-monochrome.png`,
  };
}
