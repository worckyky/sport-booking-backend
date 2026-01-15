import nodemailer from 'nodemailer';
import { getSmtpConfig } from '../config/smtp';

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(params: SendMailParams): Promise<void> {
  const cfg = getSmtpConfig();

  const transporter = cfg.service
    ? nodemailer.createTransport({
        service: cfg.service,
        auth: {
          user: cfg.user,
          pass: cfg.pass
        }
      })
    : nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: {
          user: cfg.user,
          pass: cfg.pass
        }
      });

  await transporter.sendMail({
    from: cfg.fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html
  });
}

