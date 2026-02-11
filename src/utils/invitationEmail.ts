import { sendMail } from './mailer';

function getBaseUrl(): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

export async function sendInvitationEmail(params: {
  email: string;
  token: string;
  campaignName?: string;
  inviterName?: string;
  role: 'CAMPAIGN' | 'ADMIN';
}): Promise<void> {
  const baseUrl = getBaseUrl();
  const inviteUrl = `${baseUrl}/auth/invite?token=${encodeURIComponent(params.token)}`;

  const isCampaign = params.role === 'CAMPAIGN';
  const subject = isCampaign
    ? `Приглашение в команду «${params.campaignName || 'площадка'}»`
    : 'Приглашение стать администратором SportBooking';

  const heading = isCampaign
    ? `${params.inviterName || 'Владелец площадки'} приглашает вас в команду «${params.campaignName || 'площадка'}».`
    : `${params.inviterName || 'Администратор'} приглашает вас стать администратором платформы SportBooking.`;

  await sendMail({
    to: params.email,
    subject,
    text: `${heading}\n\nДля регистрации перейдите по ссылке: ${inviteUrl}\n\nСсылка действительна 7 дней.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">${subject}</h2>
        <p>${heading}</p>
        <p>Для регистрации перейдите по ссылке:</p>
        <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px;">Принять приглашение</a></p>
        <p style="color: #666; font-size: 14px;">Ссылка действительна 7 дней.</p>
        <p style="color: #999; font-size: 12px;">Если вы не ожидали это приглашение — просто проигнорируйте письмо.</p>
      </div>
    `
  });
}
