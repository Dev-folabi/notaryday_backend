import { ConfigService } from '@nestjs/config';
import path from 'path';

export interface EmailAssets {
  badge: string | null;
  original: string | null;
  stacked: string | null;
  monochrome: string | null;
  whiteText: string | null;
}

export function getLocalEmailAssets() {
  return {
    badge: path.join(__dirname, 'assets', 'notaryday-icon-badge.png'),
    original: path.join(__dirname, 'assets', 'notaryday-original.png'),
    stacked: path.join(__dirname, 'assets', 'notaryday-stacked.png'),
    monochrome: path.join(__dirname, 'assets', 'notaryday-monochrome.png'),
    whiteText: path.join(__dirname, 'assets', 'notaryday-white-text.png'),
  };
}

const ASSET_FILES = [
  'notaryday-icon-badge.png',
  'notaryday-original.png',
  'notaryday-stacked.png',
  'notaryday-monochrome.png',
  'notaryday-white-text.png',
];

export function getEmailAssets(config: ConfigService): EmailAssets {
  let base = (config.get<string>('EMAIL_ASSET_BASE_URL') ?? '').replace(
    /\/$/,
    '',
  );
  if (!base) {
    return {
      badge: null,
      original: null,
      stacked: null,
      monochrome: null,
      whiteText: null,
    };
  }
  // Tolerate a base URL that already ends in one of the known asset files,
  // so the directory itself is used as the prefix.
  const lastSegment = base.split('/').pop() ?? '';
  if (ASSET_FILES.includes(lastSegment)) {
    base = base.slice(0, base.length - lastSegment.length).replace(/\/$/, '');
  }

  return {
    badge: `${base}/notaryday-icon-badge.png`,
    original: `${base}/notaryday-original.png`,
    stacked: `${base}/notaryday-stacked.png`,
    monochrome: `${base}/notaryday-monochrome.png`,
    whiteText: `${base}/notaryday-white-text.png`,
  };
}
