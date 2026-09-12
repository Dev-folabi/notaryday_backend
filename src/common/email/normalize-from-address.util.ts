import { Logger } from '@nestjs/common';

export const FALLBACK_FROM_ADDRESS = 'Notary Day <noreply@notaryday.app>';

export interface ParsedFromAddress {
  name: string;
  email: string;
  formatted: string;
}

export function normalizeFromAddress(
  value: string | undefined,
  logger?: Logger,
): ParsedFromAddress {
  const cleaned = (value ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();

  if (!cleaned) {
    return parseFromParts(FALLBACK_FROM_ADDRESS);
  }

  const match = cleaned.match(/^([^<>]*?)\s*<([^<>]+)>$/);
  const email = (match ? match[2] : cleaned).trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

  if (!emailValid) {
    if (logger) {
      logger.warn(
        `From address "${cleaned}" is not valid; falling back to "${FALLBACK_FROM_ADDRESS}"`,
      );
    }
    return parseFromParts(FALLBACK_FROM_ADDRESS);
  }

  const name = match ? match[1].trim() : '';
  return {
    name,
    email,
    formatted: name ? `${name} <${email}>` : email,
  };
}

function parseFromParts(formatted: string): ParsedFromAddress {
  const match = formatted.match(/^([^<>]*?)\s*<([^<>]+)>$/);
  const email = match ? match[2].trim() : formatted;
  const name = match ? match[1].trim() : '';
  return { name, email, formatted };
}
