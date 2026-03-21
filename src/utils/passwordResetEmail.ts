import { sendMail } from './mailer';
import { baseLayout, emailHeading, emailText, emailButton, emailNote } from './email-templates';

function getResetBaseUrl(): string {
  const base =
    process.env.FRONTEND_URL ||
    process.env.PASSWORD_RESET_REDIRECT_URL ||
    'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

export async function sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
  const baseUrl = getResetBaseUrl();
  const resetUrl = `${baseUrl}/new-password?access_token=${encodeURIComponent(resetToken)}`;

  const html = baseLayout([
    emailHeading('Восстановление пароля'),
    emailText('Здравствуйте!<br><br>Вы запросили восстановление пароля на Walk&Play.'),
    emailButton('Восстановить пароль', resetUrl),
    emailNote('Ссылка действительна 1 час. Если вы не запрашивали восстановление — просто проигнорируйте это письмо.'),
  ].join(''));

  await sendMail({
    to: email,
    subject: 'Восстановление пароля',
    text: `Ссылка для восстановления пароля: ${resetUrl}`,
    html,
  });
}
