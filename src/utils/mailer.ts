import nodemailer from 'nodemailer';
import { getSmtpConfig } from '../config/smtp';

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!cachedTransporter) {
    const cfg = getSmtpConfig();
    cachedTransporter = cfg.service
      ? nodemailer.createTransport({
          service: cfg.service,
          auth: { user: cfg.user, pass: cfg.pass },
        })
      : nodemailer.createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          auth: { user: cfg.user, pass: cfg.pass },
        });
  }
  return cachedTransporter;
}

/** Send email and wait for result. Used for critical emails (confirmation, reset). */
export async function sendMail(params: SendMailParams): Promise<void> {
  const cfg = getSmtpConfig();
  const transporter = getTransporter();

  await transporter.sendMail({
    from: cfg.fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}

/** Fire-and-forget email. Used for notifications — does not block the main flow. */
export function sendMailSafe(params: SendMailParams): void {
  sendMail(params).catch((err) => {
    console.error('[EMAIL] Failed to send:', params.to, params.subject, (err as Error).message);
  });
}
