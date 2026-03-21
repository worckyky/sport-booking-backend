import { Pool } from 'pg';
import { sendMailSafe } from './mailer';
import {
  baseLayout, emailHeading, emailText, emailButton, emailInfoBlock, emailNote, getBaseUrl,
} from './email-templates';

interface BookingNotificationData {
  booking_id: string;
  client_email: string | null;
  client_name: string | null;
  field_name: string;
  field_price: number | null;
  campaign_name: string;
  campaign_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

async function getBookingNotificationData(
  db: Pool,
  bookingId: string
): Promise<BookingNotificationData | null> {
  const result = await db.query<BookingNotificationData>(
    `SELECT
       b.id as booking_id,
       u.email as client_email,
       COALESCE(b.contact_name, u.name) as client_name,
       COALESCE(b.field_name, f.name) as field_name,
       COALESCE(b.field_price, f.price_per_hour) as field_price,
       c.name as campaign_name,
       c.id as campaign_id,
       s.date as slot_date,
       s.start_time,
       s.end_time
     FROM bookings b
     JOIN booking_slots s ON b.slot_id = s.id
     JOIN fields f ON s.field_id = f.id
     JOIN campaign_info c ON f.campaign_id = c.id
     LEFT JOIN users u ON b.user_id = u.id
     WHERE b.id = $1`,
    [bookingId]
  );
  return result.rows[0] || null;
}

function formatDate(dateStr: string): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const d = new Date(dateStr);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(time: string): string {
  return time.slice(0, 5); // "10:00:00" → "10:00"
}

function formatPrice(price: number): string {
  return price.toLocaleString('ru-RU') + ' \u20BD';
}

// ── Statuses that trigger client notification ───────────

const NOTIFY_STATUSES: Record<string, {
  subject: string;
  heading: string;
  message: (name: string, campaign: string) => string;
  buttonText: string;
  buttonPath: (campaignId: string) => string;
  showPrice: boolean;
  afterButton?: string;
}> = {
  confirmed: {
    subject: 'Бронирование подтверждено',
    heading: 'Бронирование подтверждено',
    message: (name, campaign) =>
      `Здравствуйте, ${name}!<br><br>Ваше бронирование на площадке «${campaign}» подтверждено.`,
    buttonText: 'Мои бронирования',
    buttonPath: () => '/bookings',
    showPrice: true,
    afterButton: 'Ждём вас!',
  },
  rejected: {
    subject: 'Бронирование отклонено',
    heading: 'Бронирование отклонено',
    message: (name, campaign) =>
      `Здравствуйте, ${name}!<br><br>К сожалению, ваше бронирование на площадке «${campaign}» было отклонено.`,
    buttonText: 'Выбрать другое время',
    buttonPath: (campaignId) => `/campaign/${campaignId}`,
    showPrice: false,
  },
  cancelled_by_facility: {
    subject: 'Бронирование отменено',
    heading: 'Бронирование отменено',
    message: (name, campaign) =>
      `Здравствуйте, ${name}!<br><br>Ваше бронирование на площадке «${campaign}» было отменено.`,
    buttonText: 'Забронировать снова',
    buttonPath: (campaignId) => `/campaign/${campaignId}`,
    showPrice: false,
  },
  cancelled_by_admin: {
    subject: 'Бронирование отменено',
    heading: 'Бронирование отменено',
    message: (name, campaign) =>
      `Здравствуйте, ${name}!<br><br>Ваше бронирование на площадке «${campaign}» было отменено.`,
    buttonText: 'Забронировать снова',
    buttonPath: (campaignId) => `/campaign/${campaignId}`,
    showPrice: false,
  },
};

/**
 * Send email to client when booking status changes.
 * Statuses: confirmed, rejected, cancelled_by_facility, cancelled_by_admin.
 * Skips if client has no email (guest user).
 */
export async function notifyBookingStatusChanged(
  db: Pool,
  bookingId: string,
  newStatus: string
): Promise<void> {
  const config = NOTIFY_STATUSES[newStatus];
  if (!config) return;

  const data = await getBookingNotificationData(db, bookingId);
  if (!data || !data.client_email) return;

  const baseUrl = getBaseUrl();
  const clientName = data.client_name || 'клиент';

  const infoItems: Array<{ label: string; value: string }> = [
    { label: 'Поле', value: data.field_name },
    { label: 'Дата', value: formatDate(data.slot_date) },
    { label: 'Время', value: `${formatTime(data.start_time)} – ${formatTime(data.end_time)}` },
  ];
  if (config.showPrice && data.field_price) {
    infoItems.push({ label: 'Стоимость', value: formatPrice(data.field_price) });
  }

  const parts: string[] = [
    emailHeading(config.heading),
    emailText(config.message(clientName, data.campaign_name)),
    emailInfoBlock(infoItems),
  ];

  if (newStatus !== 'confirmed') {
    parts.push(emailText('Вы можете выбрать другое время на странице площадки.'));
  }

  parts.push(emailButton(config.buttonText, `${baseUrl}${config.buttonPath(data.campaign_id)}`));

  if (config.afterButton) {
    parts.push(emailText(config.afterButton));
  }

  const html = baseLayout(parts.join(''));

  sendMailSafe({
    to: data.client_email,
    subject: config.subject,
    text: `${config.heading}: ${data.field_name}, ${formatDate(data.slot_date)}, ${formatTime(data.start_time)} – ${formatTime(data.end_time)}`,
    html,
  });
}
