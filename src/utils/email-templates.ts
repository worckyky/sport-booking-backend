/**
 * Email template components — inline CSS, email-safe HTML.
 * Brand: Walk&Play, accent #2563eb.
 */

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function getBaseUrl(): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

// ── Components ──────────────────────────────────────────

export function emailHeading(text: string): string {
  return `<h2 style="font-size: 20px; font-weight: 700; color: #1a1a1a; margin: 0 0 16px; line-height: 1.3;">${text}</h2>`;
}

export function emailText(text: string): string {
  return `<p style="font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 16px;">${text}</p>`;
}

export function emailButton(text: string, url: string): string {
  return `<div style="text-align: center; margin: 0 0 24px;">
  <a href="${url}" style="display: inline-block; padding: 12px 32px; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; line-height: 1.4;">${text}</a>
</div>`;
}

export function emailNote(text: string): string {
  return `<p style="font-size: 13px; color: #9ca3af; line-height: 1.5; margin: 0;">${text}</p>`;
}

export function emailInfoBlock(items: Array<{ label: string; value: string }>): string {
  const rows = items
    .map(
      (item) =>
        `<tr>
      <td style="font-size: 13px; color: #6b7280; padding: 4px 0; width: 100px; vertical-align: top;">${item.label}</td>
      <td style="font-size: 14px; color: #1a1a1a; font-weight: 500; padding: 4px 0; vertical-align: top;">${item.value}</td>
    </tr>`
    )
    .join('');

  return `<div style="background: #f8fafc; border-left: 3px solid #2563eb; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;">
  <table cellpadding="0" cellspacing="0" width="100%">${rows}</table>
</div>`;
}

export function emailQuoteBlock(label: string, text: string): string {
  return `<div style="background: #fef9ee; border-left: 3px solid #f59e0b; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
  <p style="font-size: 13px; color: #92400e; font-weight: 600; margin: 0 0 4px;">${label}</p>
  <p style="font-size: 14px; color: #78350f; line-height: 1.5; margin: 0;">${text}</p>
</div>`;
}

// ── Base Layout ─────────────────────────────────────────

export function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="background-color: #f5f5f5; padding: 0; margin: 0; font-family: ${FONT_FAMILY};">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto;">
    <tr>
      <td style="text-align: center; padding: 32px 24px 16px;">
        <span style="font-size: 24px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px;">Walk&Play</span>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 16px 24px;">
        <div style="background: #ffffff; border-radius: 12px; padding: 32px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
          ${content}
        </div>
      </td>
    </tr>
    <tr>
      <td style="text-align: center; padding: 8px 24px 32px;">
        <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px;">Walk&Play — площадки для спорта и отдыха</p>
        <p style="font-size: 11px; color: #c0c0c0; margin: 0;">Это автоматическое письмо, не отвечайте на него</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Re-export baseUrl helper ────────────────────────────

export { getBaseUrl };
