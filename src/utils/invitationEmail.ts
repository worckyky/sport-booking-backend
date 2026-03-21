import { sendMail } from './mailer';
import { baseLayout, emailHeading, emailText, emailButton, emailNote } from './email-templates';

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
    : 'Приглашение стать администратором Walk&Play';

  const heading = isCampaign ? 'Приглашение в команду' : 'Приглашение администратора';

  const bodyText = isCampaign
    ? `${params.inviterName || 'Владелец площадки'} приглашает вас в команду «${params.campaignName || 'площадка'}».`
    : `${params.inviterName || 'Администратор'} приглашает вас стать администратором платформы Walk&Play.`;

  const html = baseLayout([
    emailHeading(heading),
    emailText(bodyText),
    emailButton('Принять приглашение', inviteUrl),
    emailNote('Ссылка действительна 7 дней. Если вы не ожидали это приглашение — просто проигнорируйте письмо.'),
  ].join(''));

  await sendMail({
    to: params.email,
    subject,
    text: `${bodyText}\n\nДля регистрации перейдите по ссылке: ${inviteUrl}\n\nСсылка действительна 7 дней.`,
    html,
  });
}
