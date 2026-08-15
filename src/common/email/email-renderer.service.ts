import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getEmailAssets, type EmailAssets } from './email-assets';

export interface EmailRenderData {
  title: string;
  subtitle?: string;
  dateLabel?: string;
  greeting?: string;
  intro?: string;
  contentHtml: string;
  footer?: string;
  plainText: string;
  action?: { label: string; url: string };
  compactLogo?: boolean;
}

@Injectable()
export class EmailRendererService {
  private readonly assets: EmailAssets;
  private readonly appUrl: string;

  constructor(config: ConfigService) {
    this.assets = getEmailAssets(config);
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  render(data: EmailRenderData): { html: string; text: string } {
    const logo = this.assets.whiteText ?? this.assets.badge;
    const logoHtml = logo
      ? `<img src="${this.escapeAttribute(logo)}" alt="Notary Day" width="${data.compactLogo ? 34 : 132}" style="display:block;max-width:${data.compactLogo ? 34 : 132}px;height:auto;border:0">`
      : `<div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;color:#ffffff">Notary Day</div>`;
    const actionUrl = data.action
      ? new URL(data.action.url, this.appUrl).toString()
      : null;
    const action =
      data.action && actionUrl
        ? `<p style="margin:22px 0;text-align:center"><a href="${this.escapeAttribute(actionUrl)}" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">${this.escapeHtml(data.action.label)}</a></p>`
        : '';

    const html = `<!doctype html><html><body style="margin:0;background:#F8FAFC;color:#475569;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden"><tr><td style="background:#0F2C4E;padding:16px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>${logoHtml}<div style="color:rgba(255,255,255,.62);font-size:11px;line-height:1.4;margin-top:6px">${this.escapeHtml(data.subtitle ?? '')}</div></td>${data.dateLabel ? `<td align="right" valign="top" style="color:rgba(255,255,255,.58);font-size:11px;white-space:nowrap">${this.escapeHtml(data.dateLabel)}</td>` : ''}</tr></table></td></tr><tr><td style="padding:24px 22px"><h1 style="margin:0 0 14px;color:#0F2C4E;font-family:Arial,sans-serif;font-size:20px;line-height:1.25">${this.escapeHtml(data.title)}</h1>${data.greeting ? `<p style="margin:0 0 12px;color:#0F2C4E;font-size:14px;font-weight:700">${this.escapeHtml(data.greeting)}</p>` : ''}${data.intro ? `<p style="margin:0 0 16px;color:#475569;font-size:13px;line-height:1.7">${data.intro}</p>` : ''}${data.contentHtml}${action}${data.footer ? `<p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #E2E8F0;color:#64748B;font-size:11px;line-height:1.6">${data.footer}</p>` : ''}</td></tr><tr><td style="padding:14px 22px;background:#F8FAFC;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:10px;line-height:1.5">Powered by Notary Day</td></tr></table></td></tr></table></body></html>`;
    return { html, text: data.plainText };
  }

  detailBlock(rows: Array<[string, string]>): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;margin:0 0 14px">${rows.map(([label, value]) => `<tr><td style="padding:3px 12px 3px 0;color:#64748B;font-size:12px;font-weight:600;vertical-align:top;white-space:nowrap">${this.escapeHtml(label)}</td><td style="padding:3px 0;color:#0F2C4E;font-size:12px;line-height:1.45">${this.escapeHtml(value)}</td></tr>`).join('')}</table>`;
  }

  escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}
