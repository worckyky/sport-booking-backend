import { Pool } from 'pg';
import { sendMailSafe } from './mailer';
import {
  baseLayout, emailHeading, emailText, emailButton, emailQuoteBlock, getBaseUrl,
} from './email-templates';

interface CampaignOwnerData {
  campaign_name: string;
  owner_email: string | null;
  owner_name: string | null;
}

async function getCampaignOwnerData(
  db: Pool,
  campaignId: string
): Promise<CampaignOwnerData | null> {
  const result = await db.query<CampaignOwnerData>(
    `SELECT c.name as campaign_name, u.email as owner_email, u.name as owner_name
     FROM campaign_info c
     JOIN users u ON c.user_id = u.id
     WHERE c.id = $1`,
    [campaignId]
  );
  return result.rows[0] || null;
}

/**
 * Send email to campaign owner when moderation status changes.
 * - published → "площадка одобрена"
 * - draft + comment → "площадка отклонена"
 */
export async function notifyCampaignModeration(
  db: Pool,
  campaignId: string,
  newStatus: string,
  comment?: string
): Promise<void> {
  const data = await getCampaignOwnerData(db, campaignId);
  if (!data || !data.owner_email) return;

  const baseUrl = getBaseUrl();
  const ownerName = data.owner_name || 'владелец';

  if (newStatus === 'published') {
    const html = baseLayout([
      emailHeading('Площадка одобрена'),
      emailText(`Здравствуйте, ${ownerName}!`),
      emailText(`Ваша площадка «${data.campaign_name}» прошла модерацию и опубликована на Walk&Play.`),
      emailText('Теперь клиенты могут находить вашу площадку в каталоге и бронировать время.'),
      emailButton('Перейти в панель управления', `${baseUrl}/admin`),
    ].join(''));

    sendMailSafe({
      to: data.owner_email,
      subject: `Ваша площадка «${data.campaign_name}» одобрена`,
      text: `Ваша площадка «${data.campaign_name}» прошла модерацию и опубликована на Walk&Play.`,
      html,
    });
  } else if (newStatus === 'draft' && comment) {
    const html = baseLayout([
      emailHeading('Площадка требует доработки'),
      emailText(`Здравствуйте, ${ownerName}!<br><br>Ваша площадка «${data.campaign_name}» не прошла модерацию.`),
      emailQuoteBlock('Комментарий модератора:', comment),
      emailText('Пожалуйста, внесите необходимые изменения и отправьте площадку на повторную проверку.'),
      emailButton('Внести изменения', `${baseUrl}/admin/settings`),
    ].join(''));

    sendMailSafe({
      to: data.owner_email,
      subject: `Площадка «${data.campaign_name}» требует доработки`,
      text: `Ваша площадка «${data.campaign_name}» не прошла модерацию. Комментарий: ${comment}`,
      html,
    });
  }
}
