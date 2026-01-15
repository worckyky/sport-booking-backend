import { sendMail } from './mailer';

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

  await sendMail({
    to: email,
    subject: 'Восстановление пароля',
    text: `Ссылка для восстановления пароля: ${resetUrl}`,
    html: `
      <div>
        <p>Для восстановления пароля перейдите по ссылке:</p>
        <p><a href="${resetUrl}">Восстановить пароль</a></p>
        <p>Если вы не запрашивали восстановление — просто игнорируйте это письмо.</p>
      </div>
    `
  });
}

