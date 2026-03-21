import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/auth';
import { sendMail } from './mailer';
import { baseLayout, emailHeading, emailText, emailButton, emailNote } from './email-templates';

function getConfirmBaseUrl(): string {
  const base =
    process.env.FRONTEND_URL ||
    process.env.EMAIL_REDIRECT_URL ||
    'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

export function createEmailConfirmToken(userId: string): string {
  const ttlSeconds = process.env.EMAIL_CONFIRM_TOKEN_TTL_SECONDS
    ? Number(process.env.EMAIL_CONFIRM_TOKEN_TTL_SECONDS)
    : 24 * 60 * 60;

  return jwt.sign({ purpose: 'email_confirm' }, getJwtSecret(), {
    subject: userId,
    expiresIn: Number.isFinite(ttlSeconds) ? ttlSeconds : 24 * 60 * 60
  });
}

export async function sendEmailConfirmation(email: string, token: string): Promise<void> {
  const baseUrl = getConfirmBaseUrl();
  const confirmUrl = `${baseUrl}/confirm?access_token=${encodeURIComponent(token)}`;

  const html = baseLayout([
    emailHeading('Подтверждение регистрации'),
    emailText('Здравствуйте!<br><br>Для завершения регистрации на Walk&Play подтвердите ваш email.'),
    emailButton('Подтвердить email', confirmUrl),
    emailNote('Ссылка действительна 24 часа. Если вы не регистрировались — просто проигнорируйте это письмо.'),
  ].join(''));

  await sendMail({
    to: email,
    subject: 'Подтверждение регистрации',
    text: `Подтвердите регистрацию по ссылке: ${confirmUrl}`,
    html,
  });
}
