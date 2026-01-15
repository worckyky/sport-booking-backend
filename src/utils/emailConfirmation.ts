import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/auth';
import { sendMail } from './mailer';

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
  // Link must lead to frontend; frontend should call backend /auth/confirm with the token
  const confirmUrl = `${baseUrl}/confirm?access_token=${encodeURIComponent(token)}`;

  await sendMail({
    to: email,
    subject: 'Подтверждение регистрации',
    text: `Подтвердите регистрацию по ссылке: ${confirmUrl}`,
    html: `
      <div>
        <p>Подтвердите регистрацию:</p>
        <p><a href="${confirmUrl}">Подтвердить email</a></p>
        <p>Если вы не регистрировались — просто игнорируйте это письмо.</p>
      </div>
    `
  });
}

