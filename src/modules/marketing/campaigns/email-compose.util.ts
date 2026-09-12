import { CampaignAudienceFilters } from '../schemas/campaign.schema';
import type { Lead } from '../schemas/lead.schema';

/**
 * Turns plain-text campaign content into a sendable email:
 * template variables, linkified HTML, unsubscribe footer (CAN-SPAM),
 * open pixel, click-wrapped links and RFC 8058 one-click headers.
 */

export interface ComposeInput {
  subject: string;
  textBody: string;
  recipientId: string;
  unsubToken: string;
  publicBaseUrl: string;
  physicalAddress?: string;
}

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

function renderHtmlBody(
  text: string,
  clickWrap: (url: string) => string,
): string {
  const parts = text.split(URL_RE);
  const html = parts
    .map((part, i) => {
      // Odd indexes are URLs captured by the split
      if (i % 2 === 1) {
        return `<a href="${clickWrap(part)}">${escapeHtml(part)}</a>`;
      }
      return escapeHtml(part);
    })
    .join('')
    .replace(/\n/g, '<br/>\n');
  return html;
}

export function composeMarketingEmail(input: ComposeInput): ComposedEmail {
  const base = input.publicBaseUrl.replace(/\/+$/, '');
  const unsubUrl = `${base}/api/v1/marketing/u/${input.unsubToken}`;
  const pixelUrl = `${base}/api/v1/marketing/t/${input.recipientId}.gif`;
  const clickWrap = (url: string) =>
    `${base}/api/v1/marketing/c/${input.recipientId}?u=${encodeURIComponent(url)}`;

  const body = input.textBody.trim();
  const addressLine = input.physicalAddress?.trim();

  // Plain-text version
  const textParts = [
    body,
    '—',
    ...(addressLine ? [addressLine] : []),
    `Don't want these emails? Unsubscribe: ${unsubUrl}`,
  ];
  const text = textParts.join('\n\n');

  // HTML version
  const htmlBody = renderHtmlBody(body, clickWrap);
  const footerHtml = `
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #ececec;font-size:11px;line-height:1.5;color:#9ca3af;font-family:Arial,Helvetica,sans-serif">
  ${addressLine ? `<p style="margin:0 0 4px">${escapeHtml(addressLine)}</p>` : ''}
  <p style="margin:0">Don't want these emails? <a href="${unsubUrl}" style="color:#6b7280">Unsubscribe</a></p>
</div>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#1f2937;max-width:600px">${htmlBody}${footerHtml}</div><img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;

  return {
    subject: input.subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** 1x1 transparent GIF used by the open pixel. */
export const TRACKING_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

// ---- Template rendering ({{variable}} substitution) ----

type LeadLike = Pick<
  Lead,
  | 'businessName'
  | 'professionalName'
  | 'email'
  | 'website'
  | 'city'
  | 'state'
  | 'personalizationHook'
  | 'bestAngle'
  | 'leadId'
> | null;

export function renderTemplate(template: string, lead: LeadLike): string {
  if (!lead) return template;
  const firstName =
    (lead.professionalName ?? '').trim().split(/\s+/)[0] ||
    (lead.businessName ?? '').trim().split(/\s+/)[0] ||
    'there';
  const vars: Record<string, string> = {
    business_name: lead.businessName ?? '',
    professional_name: lead.professionalName ?? '',
    first_name: firstName,
    city: lead.city ?? '',
    state: lead.state ?? '',
    website: lead.website ?? '',
    personalization_hook: lead.personalizationHook ?? '',
    best_angle: lead.bestAngle ?? '',
    lead_id: lead.leadId ?? '',
    email: lead.email ?? '',
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in vars ? vars[key] : match,
  );
}

export function audienceFilterDescription(
  filters: CampaignAudienceFilters,
): string {
  const parts: string[] = [];
  if (filters.tier) parts.push(`tier ${filters.tier}`);
  if (filters.wave) parts.push(filters.wave);
  if (filters.state) parts.push(filters.state);
  if (filters.abGroup) parts.push(`AB ${filters.abGroup}`);
  if (filters.channel) parts.push(filters.channel);
  if (filters.tags?.length) parts.push(`tags: ${filters.tags.join('/')}`);
  return parts.length > 0 ? parts.join(' · ') : 'all leads';
}
