/**
 * Seed скрипт для генерации демо-данных (админка + суперадминка)
 *
 * Генерирует:
 * - 8 площадок (4 published, 2 pending, 2 draft) в 6 городах
 * - ~22 поля
 * - ~360 пользователей (350 USER + 8 CAMPAIGN + 1 ADMIN)
 * - ~4400 бронирований за 74 дня
 * - ~60 записей audit log
 * - ~15 записей campaign status log
 *
 * Запуск: npm run seed:demo
 */

import { Pool } from 'pg';
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

// ===== CONFIG =====
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sport_booking';
const pool = new Pool({ connectionString: DATABASE_URL });

const ADMIN_USER_ID = '330e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin@test.com';
const EXISTING_CAMPAIGN_1 = { id: '550e8400-e29b-41d4-a716-446655440001', ownerId: '220e8400-e29b-41d4-a716-446655440002' };
const EXISTING_CAMPAIGN_2 = { id: '550e8400-e29b-41d4-a716-446655440002', ownerId: '220e8400-e29b-41d4-a716-446655440003' };

// ===== TYPES =====
interface FieldConfig {
  name: string;
  sport: string;
  indoor: boolean;
  price: number;
  duration: number;
  fromHour: number;
  toHour: number;
  sundayOff: boolean;
  info: string;
}

interface RegisteredUser {
  id: string;
  name: string;
  phone: string;
}

interface ClientFreq {
  userId: string | null;
  phone: string;
  name: string;
  bookings: number;
}

interface BookingStats {
  total: number;
  skipped: number;
  platform: number;
  manual: number;
}

// ===== СПРАВОЧНИКИ =====
const FIRST_NAMES = [
  'Александр', 'Дмитрий', 'Максим', 'Артем', 'Иван', 'Михаил', 'Даниил', 'Егор', 'Андрей', 'Кирилл',
  'Роман', 'Владислав', 'Никита', 'Сергей', 'Алексей', 'Павел', 'Денис', 'Тимофей', 'Илья', 'Антон',
  'Анна', 'Мария', 'Елена', 'Ольга', 'Екатерина', 'Наталья', 'Ирина', 'Татьяна', 'Светлана', 'Юлия',
  'Дарья', 'Полина', 'Анастасия', 'Виктория', 'Софья', 'Алина', 'Ксения', 'Валерия', 'Вероника', 'Маргарита',
  'Владимир', 'Олег', 'Евгений', 'Игорь', 'Константин', 'Николай', 'Руслан', 'Станислав', 'Георгий', 'Вадим',
];

const LAST_NAMES = [
  'Иванов', 'Петров', 'Сидоров', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Соколов', 'Михайлов', 'Новиков',
  'Федоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семенов', 'Егоров', 'Павлов', 'Козлов', 'Степанов',
  'Николаев', 'Орлов', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Соловьев', 'Борисов', 'Яковлев',
  'Григорьев', 'Романов', 'Воробьев', 'Сергеев', 'Кузьмин', 'Фролов', 'Александров', 'Дмитриев', 'Королев', 'Гусев',
  'Киселев', 'Максимов', 'Поляков', 'Ильин', 'Гаврилов', 'Титов', 'Кудрявцев', 'Баранов', 'Куликов', 'Тарасов',
];

const BOOKING_COMMENTS = [
  'Принесём свои мячи', 'Будет 10 человек', 'Нужна сетка', 'Можно прийти на 10 мин раньше?',
  'Играем в мини-футбол', 'Празднуем день рождения', 'Тренировка команды', 'Нужен свет',
  'Бронирую на 2 часа подряд', 'Будут дети, нужны маленькие ворота',
  null, null, null, null, null, null, null, null, null, null,
];

const HOUR_WEIGHTS: Record<number, number> = {
  7: 1, 8: 2, 9: 3, 10: 5, 11: 6, 12: 5, 13: 4, 14: 4,
  15: 6, 16: 7, 17: 10, 18: 12, 19: 10, 20: 8, 21: 6, 22: 3,
};

const DOW_WEIGHTS = [5, 5, 6, 6, 7, 12, 10]; // Пн-Вс

const STATUS_DISTRIBUTION: Record<string, number> = {
  completed: 0.55, confirmed: 0.20, pending: 0.05,
  cancelled_by_client: 0.08, no_show: 0.05, expired: 0.04, rejected: 0.03,
};

// ===== FIELD CONFIGS PER CAMPAIGN =====

const CAMPAIGN_1_FIELDS: FieldConfig[] = [
  { name: 'Футбольное поле №1', sport: 'FOOTBALL', indoor: false, price: 2000, duration: 60, fromHour: 8, toHour: 22, sundayOff: false, info: 'Натуральный газон, размер 60×40м. Мячи в аренду на ресепшен.' },
  { name: 'Футбольное поле №2', sport: 'FOOTBALL', indoor: false, price: 1800, duration: 60, fromHour: 8, toHour: 22, sundayOff: true, info: 'Искусственный газон, размер 40×25м. Освещение включено в стоимость.' },
  { name: 'Теннисный корт', sport: 'TENNIS', indoor: true, price: 1500, duration: 60, fromHour: 9, toHour: 21, sundayOff: false, info: 'Хард-покрытие, крытый. Ракетки и мячи в аренду.' },
  { name: 'Баскетбольная площадка', sport: 'BASKETBALL', indoor: false, price: 1200, duration: 60, fromHour: 10, toHour: 21, sundayOff: false, info: 'Открытая площадка с профессиональными кольцами.' },
  { name: 'Мини-футбол (крытый)', sport: 'FOOTBALL', indoor: true, price: 2500, duration: 90, fromHour: 8, toHour: 23, sundayOff: false, info: 'Крытый зал с подогревом. Размер 30×15м. Работает круглый год.' },
];

const CAMPAIGN_2_FIELDS: FieldConfig[] = [
  { name: 'Корт №1 (крытый, хард)', sport: 'TENNIS', indoor: true, price: 1800, duration: 60, fromHour: 7, toHour: 23, sundayOff: false, info: 'Крытый корт с хард-покрытием. Ракетки и мячи в аренду.' },
  { name: 'Корт №2 (открытый, грунт)', sport: 'TENNIS', indoor: false, price: 1400, duration: 60, fromHour: 8, toHour: 21, sundayOff: false, info: 'Открытый грунтовый корт.' },
  { name: 'Тренировочная стенка', sport: 'TENNIS', indoor: true, price: 800, duration: 60, fromHour: 9, toHour: 21, sundayOff: true, info: 'Зал для индивидуальных тренировок.' },
];

const CAMPAIGN_3_FIELDS: FieldConfig[] = [
  { name: 'Большое поле (90×60)', sport: 'FOOTBALL', indoor: false, price: 3500, duration: 90, fromHour: 8, toHour: 22, sundayOff: false, info: 'Полноразмерное футбольное поле с искусственным газоном.' },
  { name: 'Малое поле №1', sport: 'FOOTBALL', indoor: false, price: 2500, duration: 60, fromHour: 8, toHour: 22, sundayOff: false, info: 'Поле для мини-футбола 40×20м.' },
  { name: 'Малое поле №2', sport: 'FOOTBALL', indoor: false, price: 2500, duration: 60, fromHour: 8, toHour: 22, sundayOff: true, info: 'Поле для мини-футбола 40×20м. С освещением.' },
  { name: 'Крытый манеж', sport: 'FOOTBALL', indoor: true, price: 3000, duration: 60, fromHour: 7, toHour: 23, sundayOff: false, info: 'Крытый манеж с подогревом. Работает круглый год.' },
];

const CAMPAIGN_4_FIELDS: FieldConfig[] = [
  { name: 'Основной зал', sport: 'BASKETBALL', indoor: true, price: 2200, duration: 60, fromHour: 8, toHour: 22, sundayOff: false, info: 'Полноразмерная баскетбольная площадка с трибунами.' },
  { name: 'Тренировочный зал', sport: 'BASKETBALL', indoor: true, price: 1500, duration: 60, fromHour: 9, toHour: 21, sundayOff: false, info: 'Зал для тренировок. 2 кольца, мячи предоставляются.' },
  { name: 'Волейбольная площадка', sport: 'VOLLEYBALL', indoor: true, price: 1800, duration: 60, fromHour: 10, toHour: 21, sundayOff: true, info: 'Профессиональная сетка. Мячи в аренду.' },
];

const CAMPAIGN_5_FIELDS: FieldConfig[] = [
  { name: 'Корт №1 (хард)', sport: 'TENNIS', indoor: false, price: 2500, duration: 60, fromHour: 8, toHour: 21, sundayOff: false, info: 'Открытый хард-корт с видом на море.' },
  { name: 'Корт №2 (хард)', sport: 'TENNIS', indoor: false, price: 2500, duration: 60, fromHour: 8, toHour: 21, sundayOff: false, info: 'Открытый хард-корт.' },
  { name: 'Корт №3 (грунт)', sport: 'TENNIS', indoor: false, price: 2200, duration: 60, fromHour: 9, toHour: 20, sundayOff: false, info: 'Грунтовый корт. Профессиональное покрытие.' },
  { name: 'Крытый корт', sport: 'TENNIS', indoor: true, price: 3000, duration: 60, fromHour: 7, toHour: 23, sundayOff: false, info: 'Крытый корт с кондиционированием.' },
];

const CAMPAIGN_6_FIELDS: FieldConfig[] = [
  { name: 'Зал №1 (большой)', sport: 'FOOTBALL', indoor: true, price: 2500, duration: 90, fromHour: 8, toHour: 23, sundayOff: false, info: 'Крытый зал 40×20м. Профессиональное покрытие.' },
  { name: 'Зал №2 (малый)', sport: 'FOOTBALL', indoor: true, price: 1800, duration: 60, fromHour: 8, toHour: 22, sundayOff: false, info: 'Зал для тренировок 20×15м.' },
  { name: 'Открытая площадка', sport: 'FOOTBALL', indoor: false, price: 1500, duration: 60, fromHour: 9, toHour: 21, sundayOff: true, info: 'Площадка с искусственным газоном.' },
];

const CAMPAIGN_8_FIELDS: FieldConfig[] = [
  { name: 'Зал', sport: 'BASKETBALL', indoor: true, price: 1500, duration: 60, fromHour: 10, toHour: 21, sundayOff: false, info: 'Баскетбольный зал.' },
];

// ===== HELPERS =====
function uuid(): string { return crypto.randomUUID(); }
function randomElement<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randomPhone(): string { return `79${Math.floor(Math.random() * 900000000) + 100000000}`; }
function pad2(n: number): string { return n.toString().padStart(2, '0'); }
function dateToString(date: Date): string { return date.toISOString().split('T')[0]; }

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

let emailCounter = 0;
function randomEmail(firstName: string, lastName: string): string {
  const domains = ['gmail.com', 'yandex.ru', 'mail.ru', 'outlook.com'];
  emailCounter++;
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${emailCounter}@${randomElement(domains)}`;
}

function weightedRandom(weights: Record<number, number>): number {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (const [key, weight] of Object.entries(weights)) {
    rand -= weight;
    if (rand <= 0) return Number(key);
  }
  return Number(Object.keys(weights)[0]);
}

function getWeightedStatus(): string {
  const rand = Math.random();
  let cumulative = 0;
  for (const [status, probability] of Object.entries(STATUS_DISTRIBUTION)) {
    cumulative += probability;
    if (rand <= cumulative) return status;
  }
  return 'completed';
}

function getFieldHours(field: FieldConfig): number[] {
  const hours: number[] = [];
  const slotsPerHour = field.duration / 60;
  for (let h = field.fromHour; h + slotsPerHour <= field.toHour; h++) {
    hours.push(h);
  }
  return hours;
}

function generateWeightedDate(startDate: Date, endDate: Date): Date {
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  if (totalDays <= 0) return new Date(startDate);
  for (let attempt = 0; attempt < 20; attempt++) {
    const dayOffset = Math.floor(Math.random() * totalDays);
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1;
    if (Math.random() * 12 < DOW_WEIGHTS[dow]) return date;
  }
  const dayOffset = Math.floor(Math.random() * totalDays);
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function makeFieldTimetable(field: FieldConfig): string {
  const day = (from: string, to: string) => ({ from, to, breaks: [] });
  const fromStr = `${pad2(field.fromHour)}:00`;
  const toStr = `${pad2(field.toHour)}:00`;
  return JSON.stringify({
    monday: day(fromStr, toStr),
    tuesday: day(fromStr, toStr),
    wednesday: day(fromStr, toStr),
    thursday: day(fromStr, toStr),
    friday: day(fromStr, toStr),
    saturday: day(fromStr, toStr),
    sunday: field.sundayOff ? null : day(fromStr, toStr),
  });
}

// ===== CORE FUNCTIONS =====

async function createFieldsForCampaign(campaignId: string, fields: FieldConfig[]): Promise<string[]> {
  const fieldIds: string[] = [];
  for (const field of fields) {
    const fieldId = uuid();
    fieldIds.push(fieldId);
    await pool.query(`
      INSERT INTO fields (id, campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
        status, slot_duration, working_timetable, client_info, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, NOW())
    `, [
      fieldId, campaignId, field.name, [field.sport], field.indoor,
      [`https://via.placeholder.com/800x600?text=${encodeURIComponent(field.name)}`],
      field.price, field.duration, makeFieldTimetable(field), field.info,
    ]);
  }
  return fieldIds;
}

/** Builds client frequency distribution scaled to target booking count */
function buildClientFrequency(
  users: RegisteredUser[],
  guestCount: number,
  targetBookings: number,
): ClientFreq[] {
  const clients: ClientFreq[] = [];
  const totalUsers = users.length;

  // One-timers: 40% of users, 1 booking each
  const oneTimerCount = Math.floor(totalUsers * 0.4);
  for (let i = 0; i < oneTimerCount; i++) {
    const user = users[i];
    clients.push({ userId: user.id, phone: user.phone, name: user.name, bookings: 1 });
  }

  // Occasional (2-4): 30% of users
  const occasionalCount = Math.floor(totalUsers * 0.3);
  for (let i = oneTimerCount; i < oneTimerCount + occasionalCount; i++) {
    const user = users[i];
    clients.push({ userId: user.id, phone: user.phone, name: user.name, bookings: 2 + Math.floor(Math.random() * 3) });
  }

  // Regular (5-10): 20% of users
  const regularStart = oneTimerCount + occasionalCount;
  const regularCount = Math.floor(totalUsers * 0.2);
  for (let i = regularStart; i < regularStart + regularCount; i++) {
    const user = users[i];
    clients.push({ userId: user.id, phone: user.phone, name: user.name, bookings: 5 + Math.floor(Math.random() * 6) });
  }

  // Loyal (10-20): 10% of users
  const loyalStart = regularStart + regularCount;
  for (let i = loyalStart; i < totalUsers; i++) {
    const user = users[i];
    clients.push({ userId: user.id, phone: user.phone, name: user.name, bookings: 10 + Math.floor(Math.random() * 11) });
  }

  // Guests with varied frequency
  const guestPhones: string[] = [];
  for (let i = 0; i < guestCount; i++) guestPhones.push(randomPhone());

  // 30% one-timers
  const guestOneTimers = Math.floor(guestCount * 0.3);
  for (let i = 0; i < guestOneTimers; i++) {
    clients.push({ userId: null, phone: guestPhones[i], name: `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`, bookings: 1 });
  }
  // 30% occasional (3-6)
  const guestOccasional = Math.floor(guestCount * 0.3);
  for (let i = guestOneTimers; i < guestOneTimers + guestOccasional; i++) {
    clients.push({ userId: null, phone: guestPhones[i], name: `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`, bookings: 3 + Math.floor(Math.random() * 4) });
  }
  // 40% regulars (8-20)
  for (let i = guestOneTimers + guestOccasional; i < guestCount; i++) {
    clients.push({ userId: null, phone: guestPhones[i], name: `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`, bookings: 8 + Math.floor(Math.random() * 13) });
  }

  // Scale bookings to hit target
  const currentTotal = clients.reduce((sum, c) => sum + c.bookings, 0);
  if (currentTotal > 0) {
    const adjustFactor = targetBookings / currentTotal;
    for (const c of clients) {
      c.bookings = Math.max(1, Math.round(c.bookings * adjustFactor));
    }
  }

  return clients;
}

/** Generates bookings for a single campaign */
async function generateBookingsForCampaign(
  fields: FieldConfig[],
  fieldIds: string[],
  clients: ClientFreq[],
): Promise<BookingStats> {
  const now = new Date();
  const startDate = daysAgo(60);
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 14);

  const occupiedSlots = new Set<string>();
  let total = 0, skipped = 0, platform = 0, manual = 0;

  for (const client of clients) {
    const recencyBias = Math.max(0, 1 - client.bookings / 15);
    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const earliestDay = Math.floor(totalDays * recencyBias * 0.6);
    const clientStartDate = new Date(startDate);
    clientStartDate.setDate(clientStartDate.getDate() + earliestDay);

    for (let i = 0; i < client.bookings; i++) {
      const bookingDate = generateWeightedDate(clientStartDate, endDate);
      const dateStr = dateToString(bookingDate);
      const dow = bookingDate.getDay() === 0 ? 6 : bookingDate.getDay() - 1;

      // Pick field (skip sunday-off fields on Sunday)
      let fieldIdx: number;
      let attempts = 0;
      do {
        fieldIdx = Math.floor(Math.random() * fields.length);
        attempts++;
      } while (fields[fieldIdx].sundayOff && dow === 6 && attempts < 10);
      if (fields[fieldIdx].sundayOff && dow === 6) fieldIdx = 0;

      const field = fields[fieldIdx];
      const fieldId = fieldIds[fieldIdx];

      // Pick weighted hour
      const validHours = getFieldHours(field);
      const fieldHourWeights: Record<number, number> = {};
      for (const h of validHours) {
        if (HOUR_WEIGHTS[h]) fieldHourWeights[h] = HOUR_WEIGHTS[h];
      }
      if (Object.keys(fieldHourWeights).length === 0) continue;
      const hour = weightedRandom(fieldHourWeights);

      // Check collision
      const slotKey = `${fieldId}:${dateStr}:${hour}`;
      if (occupiedSlots.has(slotKey)) { skipped++; continue; }
      occupiedSlots.add(slotKey);

      const startTime = `${pad2(hour)}:00`;
      const endMinutes = hour * 60 + field.duration;
      const endTime = `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;

      // Status based on date
      let status: string;
      const todayStr = dateToString(now);
      if (dateStr > todayStr) {
        status = Math.random() < 0.75 ? 'confirmed' : 'pending';
      } else if (dateStr === todayStr) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (endMinutes > nowMinutes) {
          status = Math.random() < 0.75 ? 'confirmed' : 'pending';
        } else {
          status = getWeightedStatus();
          if (['pending', 'confirmed'].includes(status)) status = 'completed';
        }
      } else {
        status = getWeightedStatus();
        if (['pending', 'confirmed'].includes(status)) status = 'completed';
      }

      // Realistic created_at
      const daysBeforeSlot = 1 + Math.floor(Math.random() * 7);
      const createdAt = new Date(bookingDate);
      createdAt.setDate(createdAt.getDate() - daysBeforeSlot);
      if (createdAt < startDate) createdAt.setTime(startDate.getTime());
      const createdAtStr = createdAt.toISOString();

      // Insert slot + booking
      const slotId = uuid();
      await pool.query(
        `INSERT INTO booking_slots (id, field_id, date, start_time, end_time, is_blocked, created_at)
         VALUES ($1, $2, $3, $4, $5, false, $6)`,
        [slotId, fieldId, dateStr, startTime, endTime, createdAtStr],
      );

      await pool.query(
        `INSERT INTO bookings (id, slot_id, user_id, status, comment, contact_name, contact_phone,
           field_name, field_price, sport_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [uuid(), slotId, client.userId, status, randomElement(BOOKING_COMMENTS),
         client.name, client.phone, field.name, field.price, field.sport, createdAtStr],
      );

      total++;
      if (client.userId) platform++; else manual++;
    }
  }

  return { total, skipped, platform, manual };
}

// ===== MAIN =====
async function main() {
  console.log('🌱 Starting enhanced demo seed...\n');

  try {
    // Verify base seed
    const { rows: existingCampaigns } = await pool.query('SELECT id FROM campaign_info');
    if (existingCampaigns.length < 2) {
      throw new Error('Base seed not found! Run: npm run seed');
    }

    const passwordHash = await bcrypt.hash('demo123', 12);

    // ================================================================
    // STEP 1: Update existing campaigns + clean old data
    // ================================================================
    console.log('1️⃣  Updating existing campaigns...');

    // Campaign #1: СпортПарк Казань
    await pool.query(`
      UPDATE campaign_info SET
        name = $1, description = $2, short_description = $3,
        location = $4, contacts = $5, working_timetable = $6,
        socials_links = $7, payment_methods = $8, facilities = $9,
        booking_info = $10, timezone_id = $11
      WHERE id = $12
    `, [
      'СпортПарк Казань',
      'Современный спортивный комплекс с открытыми и крытыми площадками для футбола, тенниса и баскетбола. 5 полей, парковка, раздевалки, кафе.',
      'Футбол, теннис, баскетбол — всё в одном месте',
      JSON.stringify({ city: 'Казань', address: 'ул. Спортивная, 15', lat: 55.7887, lng: 49.1221 }),
      JSON.stringify({ phone: '79991234567', email: 'arena@sportpark-kzn.ru' }),
      JSON.stringify({
        monday: { from: '08:00', to: '23:00' }, tuesday: { from: '08:00', to: '23:00' },
        wednesday: { from: '08:00', to: '23:00' }, thursday: { from: '08:00', to: '23:00' },
        friday: { from: '08:00', to: '23:00' }, saturday: { from: '08:00', to: '23:00' },
        sunday: { from: '09:00', to: '22:00' },
      }),
      JSON.stringify([{ type: 'VK', url: 'https://vk.com/sportpark_kzn' }, { type: 'TELEGRAM', url: 'https://t.me/sportpark_kzn' }]),
      ['MONEY', 'CARD', 'SBP'],
      ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'WIFI', 'LIGHTING', 'CAFE', 'RENTAL'],
      'Вход со стороны ул. Спортивная. Парковка бесплатная. Раздевалки на 1 этаже.',
      'Europe/Moscow',
      EXISTING_CAMPAIGN_1.id,
    ]);

    // Campaign #2: Теннисный клуб "Победа"
    await pool.query(`
      UPDATE campaign_info SET
        name = $1, description = $2, short_description = $3,
        location = $4, contacts = $5, working_timetable = $6,
        socials_links = $7, payment_methods = $8, facilities = $9,
        booking_info = $10, timezone_id = $11
      WHERE id = $12
    `, [
      'Теннисный клуб "Победа"',
      'Профессиональные теннисные корты с покрытием хард и грунт. Крытые и открытые корты, тренировочная зона. Работаем круглый год.',
      'Профессиональные теннисные корты в центре Москвы',
      JSON.stringify({ city: 'Москва', address: 'ул. Теннисная, 5', lat: 55.755244, lng: 37.615423 }),
      JSON.stringify({ phone: '74959876543', email: 'info@pobeda-tennis.ru' }),
      JSON.stringify({
        monday: { from: '07:00', to: '23:00' }, tuesday: { from: '07:00', to: '23:00' },
        wednesday: { from: '07:00', to: '23:00' }, thursday: { from: '07:00', to: '23:00' },
        friday: { from: '07:00', to: '23:00' }, saturday: { from: '08:00', to: '23:00' },
        sunday: { from: '08:00', to: '22:00' },
      }),
      JSON.stringify([{ type: 'WHATS_APP', url: 'https://wa.me/74959876543' }, { type: 'VK', url: 'https://vk.com/pobeda_tennis' }]),
      ['MONEY', 'CARD'],
      ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'CAFE', 'RENTAL'],
      'Ракетки и мячи в аренду. При первом посещении обратитесь к администратору.',
      'Europe/Moscow',
      EXISTING_CAMPAIGN_2.id,
    ]);

    // Clean old fields (CASCADE: fields → booking_slots → bookings)
    await pool.query('DELETE FROM fields WHERE campaign_id IN ($1, $2)', [EXISTING_CAMPAIGN_1.id, EXISTING_CAMPAIGN_2.id]);
    console.log('   ✅ Existing campaigns updated, old fields cleaned');

    // ================================================================
    // STEP 2: Create fields for existing campaigns
    // ================================================================
    console.log('\n2️⃣  Creating fields...');
    const c1FieldIds = await createFieldsForCampaign(EXISTING_CAMPAIGN_1.id, CAMPAIGN_1_FIELDS);
    console.log(`   ✅ СпортПарк Казань: ${c1FieldIds.length} fields`);

    const c2FieldIds = await createFieldsForCampaign(EXISTING_CAMPAIGN_2.id, CAMPAIGN_2_FIELDS);
    console.log(`   ✅ Победа: ${c2FieldIds.length} fields`);

    // ================================================================
    // STEP 3: Create new campaigns with owners
    // ================================================================
    console.log('\n3️⃣  Creating new campaigns...');

    interface NewCampaign {
      id: string;
      ownerId: string;
      ownerEmail: string;
      name: string;
      status: 'published' | 'pending' | 'draft';
      fields: FieldConfig[];
      fieldIds: string[];
      bookingsTarget: number;
    }

    const newCampaigns: NewCampaign[] = [];

    const campaignDefs = [
      {
        name: 'ФутАрена Москва', status: 'published' as const, fields: CAMPAIGN_3_FIELDS, bookingsTarget: 1200,
        description: 'Профессиональные футбольные поля в Москве. Полноразмерное поле, два мини-поля и крытый манеж. Парковка, раздевалки, кафе.',
        shortDescription: 'Профессиональные футбольные поля в Москве',
        city: 'Москва', address: 'ул. Футбольная, 28', lat: 55.76, lng: 37.64, tz: 'Europe/Moscow',
        phone: '74951112233', email: 'info@futarena.ru',
        socials: [{ type: 'VK', url: 'https://vk.com/futarena_msk' }],
        payments: ['MONEY', 'CARD', 'SBP'], facilities: ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'LIGHTING', 'CAFE'],
        bookingInfo: 'Мячи предоставляются. Форму брать свою. Парковка у входа.',
      },
      {
        name: 'Баскет Центр', status: 'published' as const, fields: CAMPAIGN_4_FIELDS, bookingsTarget: 800,
        description: 'Баскетбольный и волейбольный центр в Екатеринбурге. Два зала и волейбольная площадка. Проводим турниры и тренировки.',
        shortDescription: 'Баскетбол и волейбол в Екатеринбурге',
        city: 'Екатеринбург', address: 'ул. Баскетбольная, 10', lat: 56.84, lng: 60.61, tz: 'Asia/Yekaterinburg',
        phone: '73431234567', email: 'info@basket-ekb.ru',
        socials: [{ type: 'TELEGRAM', url: 'https://t.me/basket_ekb' }],
        payments: ['MONEY', 'CARD'], facilities: ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'WIFI'],
        bookingInfo: 'Мячи предоставляются. Абонемент по запросу.',
      },
      {
        name: 'Теннис Плюс Сочи', status: 'pending' as const, fields: CAMPAIGN_5_FIELDS, bookingsTarget: 0,
        description: 'Теннисный клуб у моря. 3 открытых корта с видом на горы и 1 крытый корт. Профессиональные покрытия, аренда инвентаря.',
        shortDescription: 'Теннис у моря с видом на горы',
        city: 'Сочи', address: 'ул. Приморская, 42', lat: 43.59, lng: 39.72, tz: 'Europe/Moscow',
        phone: '78621234567', email: 'info@tennis-sochi.ru',
        socials: [{ type: 'VK', url: 'https://vk.com/tennis_sochi' }],
        payments: ['CARD', 'SBP'], facilities: ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'WIFI', 'CAFE', 'RENTAL'],
        bookingInfo: 'Ракетки в аренду. Кафе с видом на море.',
      },
      {
        name: 'Мини-Футбол НСК', status: 'pending' as const, fields: CAMPAIGN_6_FIELDS, bookingsTarget: 0,
        description: 'Два крытых зала и открытая площадка для мини-футбола в Новосибирске. Искусственное покрытие, подогрев, освещение.',
        shortDescription: 'Мини-футбол в Новосибирске',
        city: 'Новосибирск', address: 'ул. Спортивная, 88', lat: 55.01, lng: 82.94, tz: 'Asia/Novosibirsk',
        phone: '73831234567', email: 'info@minifut-nsk.ru',
        socials: [{ type: 'TELEGRAM', url: 'https://t.me/minifut_nsk' }],
        payments: ['MONEY', 'CARD'], facilities: ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'LIGHTING'],
        bookingInfo: 'Мячи предоставляются. Душевые на 1 этаже.',
      },
      {
        name: 'Спорт Комплекс Юг', status: 'draft' as const, fields: [] as FieldConfig[], bookingsTarget: 0,
        description: '', shortDescription: '',
        city: 'Сочи', address: '', lat: 43.58, lng: 39.73, tz: 'Europe/Moscow',
        phone: '', email: '',
        socials: [], payments: [] as string[], facilities: [] as string[],
        bookingInfo: '',
      },
      {
        name: 'Баскет Холл НН', status: 'draft' as const, fields: CAMPAIGN_8_FIELDS, bookingsTarget: 0,
        description: 'Баскетбольный зал в Нижнем Новгороде.', shortDescription: 'Баскетбол в Нижнем Новгороде',
        city: 'Нижний Новгород', address: 'ул. Горького, 15', lat: 56.30, lng: 43.94, tz: 'Europe/Moscow',
        phone: '78311234567', email: '',
        socials: [], payments: ['CARD'], facilities: ['SHOWER'],
        bookingInfo: '',
      },
    ];

    for (const def of campaignDefs) {
      const campaignId = uuid();
      const ownerId = uuid();
      const ownerEmail = `owner.${def.name.replace(/\s+/g, '').toLowerCase().slice(0, 12)}@demo.ru`;
      const createdAtStr = daysAgo(20 + Math.floor(Math.random() * 50)).toISOString();

      // Create campaign first (user_id = NULL to avoid circular FK)
      const timetable = def.status === 'draft' && def.fields.length === 0 ? null : JSON.stringify({
        monday: { from: '08:00', to: '23:00' }, tuesday: { from: '08:00', to: '23:00' },
        wednesday: { from: '08:00', to: '23:00' }, thursday: { from: '08:00', to: '23:00' },
        friday: { from: '08:00', to: '23:00' }, saturday: { from: '09:00', to: '22:00' },
        sunday: { from: '09:00', to: '22:00' },
      });

      await pool.query(`
        INSERT INTO campaign_info (
          id, user_id, name, description, short_description,
          location, contacts, working_timetable, socials_links,
          payment_methods, facilities, booking_info, status, timezone_id,
          created_at, updated_at
        ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
      `, [
        campaignId, def.name, def.description || null, def.shortDescription || null,
        JSON.stringify({ city: def.city, address: def.address, lat: def.lat, lng: def.lng }),
        def.phone ? JSON.stringify({ phone: def.phone, email: def.email }) : null,
        timetable,
        def.socials.length > 0 ? JSON.stringify(def.socials) : null,
        def.payments.length > 0 ? def.payments : null,
        def.facilities.length > 0 ? def.facilities : null,
        def.bookingInfo || null, def.status, def.tz, createdAtStr,
      ]);

      // Create owner user (now campaign exists, so FK is valid)
      await pool.query(
        `INSERT INTO users (id, email, password_hash, role, name, phone, email_verified, campaign_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'CAMPAIGN', $4, $5, 'VERIFIED', $6, $7, $7)`,
        [ownerId, ownerEmail, passwordHash, def.name, def.phone || randomPhone(), campaignId, createdAtStr],
      );

      // Link owner to campaign
      await pool.query('UPDATE campaign_info SET user_id = $1 WHERE id = $2', [ownerId, campaignId]);

      // Create fields
      let fieldIds: string[] = [];
      if (def.fields.length > 0) {
        fieldIds = await createFieldsForCampaign(campaignId, def.fields);
      }

      newCampaigns.push({
        id: campaignId, ownerId, ownerEmail, name: def.name,
        status: def.status, fields: def.fields, fieldIds, bookingsTarget: def.bookingsTarget,
      });

      console.log(`   ✅ ${def.name} (${def.status}, ${def.fields.length} fields)`);
    }

    // ================================================================
    // STEP 4: Create registered users
    // ================================================================
    console.log('\n4️⃣  Creating users...');
    const allUsers: RegisteredUser[] = [];

    for (let i = 0; i < 350; i++) {
      const userId = uuid();
      const firstName = randomElement(FIRST_NAMES);
      const lastName = randomElement(LAST_NAMES);
      const name = `${firstName} ${lastName}`;
      const phone = randomPhone();
      const email = randomEmail(firstName, lastName);

      // Spread registration dates: 50% 30-90 days ago, 30% 7-30 days, 20% last 7 days
      let regDaysAgo: number;
      const r = Math.random();
      if (r < 0.5) regDaysAgo = 30 + Math.floor(Math.random() * 60);
      else if (r < 0.8) regDaysAgo = 7 + Math.floor(Math.random() * 23);
      else regDaysAgo = Math.floor(Math.random() * 7);

      const isBlocked = i < 10; // First 10 users are blocked

      await pool.query(
        `INSERT INTO users (id, email, password_hash, role, name, phone, email_verified, is_blocked, created_at, updated_at)
         VALUES ($1, $2, $3, 'USER', $4, $5, $6, $7, $8, $8)`,
        [userId, email, passwordHash, name, phone,
         Math.random() < 0.8 ? 'VERIFIED' : 'NOT_VERIFIED',
         isBlocked, daysAgo(regDaysAgo).toISOString()],
      );

      allUsers.push({ id: userId, name, phone });
    }

    console.log(`   ✅ Created ${allUsers.length} users (10 blocked)`);

    // ================================================================
    // STEP 5: Generate bookings for published campaigns
    // ================================================================
    console.log('\n5️⃣  Generating bookings...');

    // Campaign #1: users[0..199], 100 guests → ~2000
    const c1Clients = buildClientFrequency(allUsers.slice(0, 200), 100, 2000);
    const c1Stats = await generateBookingsForCampaign(CAMPAIGN_1_FIELDS, c1FieldIds, c1Clients);
    console.log(`   ✅ СпортПарк Казань: ${c1Stats.total} bookings (${c1Stats.skipped} skipped)`);

    // Campaign #2: users[50..149], 40 guests → ~400
    const c2Clients = buildClientFrequency(allUsers.slice(50, 150), 40, 400);
    const c2Stats = await generateBookingsForCampaign(CAMPAIGN_2_FIELDS, c2FieldIds, c2Clients);
    console.log(`   ✅ Победа: ${c2Stats.total} bookings (${c2Stats.skipped} skipped)`);

    // New published campaigns
    const publishedNew = newCampaigns.filter(c => c.status === 'published');
    const campaignUserRanges = [[100, 250], [200, 350]]; // user index ranges
    const campaignGuestCounts = [60, 50];

    for (let i = 0; i < publishedNew.length; i++) {
      const c = publishedNew[i];
      const [fromIdx, toIdx] = campaignUserRanges[i];
      const guestCount = campaignGuestCounts[i];
      const clients = buildClientFrequency(allUsers.slice(fromIdx, toIdx), guestCount, c.bookingsTarget);
      const stats = await generateBookingsForCampaign(c.fields, c.fieldIds, clients);
      console.log(`   ✅ ${c.name}: ${stats.total} bookings (${stats.skipped} skipped)`);
    }

    // ================================================================
    // STEP 6: Audit log
    // ================================================================
    console.log('\n6️⃣  Generating audit log...');

    const auditEntries: Array<{
      eventType: string; actorId: string; actorEmail: string;
      resourceType: string; resourceId: string;
      changes: object | null; metadata: object | null; createdAt: string;
    }> = [];

    // user.blocked (10 entries)
    for (let i = 0; i < 10; i++) {
      auditEntries.push({
        eventType: 'user.blocked', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'user', resourceId: allUsers[i].id,
        changes: { is_blocked: { from: false, to: true } },
        metadata: { reason: randomElement(['Спам', 'Подозрительная активность', 'Нарушение правил', 'Фейковый аккаунт']) },
        createdAt: daysAgo(Math.floor(Math.random() * 25)).toISOString(),
      });
    }

    // user.unblocked (3 entries)
    for (let i = 0; i < 3; i++) {
      auditEntries.push({
        eventType: 'user.unblocked', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'user', resourceId: allUsers[10 + i].id,
        changes: { is_blocked: { from: true, to: false } }, metadata: null,
        createdAt: daysAgo(Math.floor(Math.random() * 15)).toISOString(),
      });
    }

    // campaign.published (for all published campaigns)
    const publishedCampaignIds = [
      EXISTING_CAMPAIGN_1.id, EXISTING_CAMPAIGN_2.id,
      ...publishedNew.map(c => c.id),
    ];
    for (const cid of publishedCampaignIds) {
      auditEntries.push({
        eventType: 'campaign.published', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'campaign', resourceId: cid,
        changes: { status: { from: 'pending', to: 'published' } }, metadata: null,
        createdAt: daysAgo(15 + Math.floor(Math.random() * 30)).toISOString(),
      });
    }

    // campaign.rejected (for pending campaign #6 which was rejected once)
    const rejectedCampaign = newCampaigns.find(c => c.name === 'Мини-Футбол НСК');
    if (rejectedCampaign) {
      auditEntries.push({
        eventType: 'campaign.rejected', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'campaign', resourceId: rejectedCampaign.id,
        changes: { status: { from: 'pending', to: 'draft' } },
        metadata: { comment: 'Необходимо добавить фотографии полей и уточнить адрес.' },
        createdAt: daysAgo(12).toISOString(),
      });
    }

    // registration_link.created (6 entries)
    for (let i = 0; i < 6; i++) {
      auditEntries.push({
        eventType: 'registration_link.created', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'registration_link', resourceId: uuid(),
        changes: null, metadata: { expires_in_days: 7 },
        createdAt: daysAgo(Math.floor(Math.random() * 40)).toISOString(),
      });
    }

    // settings.updated (2 entries) — resource_id is UUID, use metadata for key
    auditEntries.push({
      eventType: 'settings.updated', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
      resourceType: 'settings', resourceId: uuid(),
      changes: { booking_limit_per_user: { from: 5, to: 10 } }, metadata: null,
      createdAt: daysAgo(20).toISOString(),
    });
    auditEntries.push({
      eventType: 'settings.updated', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
      resourceType: 'settings', resourceId: uuid(),
      changes: { booking_rate_limit_per_min: { from: 3, to: 5 } }, metadata: null,
      createdAt: daysAgo(18).toISOString(),
    });

    // team.invited (5 entries)
    for (let i = 0; i < 5; i++) {
      auditEntries.push({
        eventType: 'team.invited', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'user', resourceId: uuid(),
        changes: null,
        metadata: { email: `manager${i + 1}@demo.ru`, role: i < 3 ? 'CAMPAIGN' : 'ADMIN' },
        createdAt: daysAgo(Math.floor(Math.random() * 30)).toISOString(),
      });
    }

    // booking.bulk_confirmed (3 entries)
    for (let i = 0; i < 3; i++) {
      auditEntries.push({
        eventType: 'booking.bulk_confirmed', actorId: ADMIN_USER_ID, actorEmail: ADMIN_EMAIL,
        resourceType: 'booking', resourceId: uuid(),
        changes: null,
        metadata: { count: 3 + Math.floor(Math.random() * 8) },
        createdAt: daysAgo(Math.floor(Math.random() * 14)).toISOString(),
      });
    }

    // Insert all audit entries
    for (const entry of auditEntries) {
      await pool.query(
        `INSERT INTO admin_audit_log (event_type, actor_id, actor_email, resource_type, resource_id, changes, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [entry.eventType, entry.actorId, entry.actorEmail, entry.resourceType, entry.resourceId,
         entry.changes ? JSON.stringify(entry.changes) : null,
         entry.metadata ? JSON.stringify(entry.metadata) : null,
         entry.createdAt],
      );
    }

    console.log(`   ✅ Created ${auditEntries.length} audit log entries`);

    // ================================================================
    // STEP 7: Campaign status log
    // ================================================================
    console.log('\n7️⃣  Generating campaign status log...');

    let statusLogCount = 0;

    // Published campaigns: draft → pending → published
    for (const cid of publishedCampaignIds) {
      const ownerId = cid === EXISTING_CAMPAIGN_1.id ? EXISTING_CAMPAIGN_1.ownerId
        : cid === EXISTING_CAMPAIGN_2.id ? EXISTING_CAMPAIGN_2.ownerId
        : newCampaigns.find(c => c.id === cid)!.ownerId;

      // draft → pending (owner submitted)
      await pool.query(
        `INSERT INTO campaign_status_log (campaign_id, old_status, new_status, changed_by, reason, created_at)
         VALUES ($1, 'draft', 'pending', $2, 'Подача на модерацию', $3)`,
        [cid, ownerId, daysAgo(40 + Math.floor(Math.random() * 20)).toISOString()],
      );
      statusLogCount++;

      // pending → published (admin approved)
      await pool.query(
        `INSERT INTO campaign_status_log (campaign_id, old_status, new_status, changed_by, reason, created_at)
         VALUES ($1, 'pending', 'published', $2, NULL, $3)`,
        [cid, ADMIN_USER_ID, daysAgo(15 + Math.floor(Math.random() * 20)).toISOString()],
      );
      statusLogCount++;
    }

    // Pending campaigns
    const pendingCampaigns = newCampaigns.filter(c => c.status === 'pending');
    for (const c of pendingCampaigns) {
      // draft → pending
      await pool.query(
        `INSERT INTO campaign_status_log (campaign_id, old_status, new_status, changed_by, reason, created_at)
         VALUES ($1, 'draft', 'pending', $2, 'Подача на модерацию', $3)`,
        [c.id, c.ownerId, daysAgo(10 + Math.floor(Math.random() * 10)).toISOString()],
      );
      statusLogCount++;

      // Campaign #6 (Мини-Футбол НСК) was rejected and resubmitted
      if (c.name === 'Мини-Футбол НСК') {
        // pending → draft (rejected)
        await pool.query(
          `INSERT INTO campaign_status_log (campaign_id, old_status, new_status, changed_by, reason, created_at)
           VALUES ($1, 'pending', 'draft', $2, 'Необходимо добавить фотографии полей и уточнить адрес.', $3)`,
          [c.id, ADMIN_USER_ID, daysAgo(8).toISOString()],
        );
        statusLogCount++;

        // draft → pending (resubmitted)
        await pool.query(
          `INSERT INTO campaign_status_log (campaign_id, old_status, new_status, changed_by, reason, created_at)
           VALUES ($1, 'draft', 'pending', $2, 'Исправлено: добавлены фото, адрес уточнён.', $3)`,
          [c.id, c.ownerId, daysAgo(5).toISOString()],
        );
        statusLogCount++;
      }
    }

    console.log(`   ✅ Created ${statusLogCount} status log entries`);

    // ================================================================
    // STEP 8: Print summary
    // ================================================================
    console.log('\n' + '='.repeat(50));
    console.log('📊 SUMMARY');
    console.log('='.repeat(50));

    const { rows: campaignStats } = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM campaign_info GROUP BY status ORDER BY status`,
    );
    console.log('\nCampaigns:');
    for (const row of campaignStats) {
      console.log(`   ${row.status}: ${row.cnt}`);
    }

    const { rows: userStats } = await pool.query(
      `SELECT role, COUNT(*) as cnt FROM users GROUP BY role ORDER BY role`,
    );
    console.log('\nUsers:');
    for (const row of userStats) {
      console.log(`   ${row.role}: ${row.cnt}`);
    }

    const { rows: blockedStats } = await pool.query(
      `SELECT COUNT(*) as cnt FROM users WHERE is_blocked = true`,
    );
    console.log(`   Blocked: ${blockedStats[0].cnt}`);

    const { rows: bookingStats } = await pool.query(
      `SELECT COUNT(*) as total FROM bookings`,
    );
    console.log(`\nBookings: ${bookingStats[0].total}`);

    const { rows: auditStats } = await pool.query(
      `SELECT COUNT(*) as total FROM admin_audit_log`,
    );
    console.log(`Audit log: ${auditStats[0].total}`);

    const { rows: statusStats } = await pool.query(
      `SELECT COUNT(*) as total FROM campaign_status_log`,
    );
    console.log(`Status log: ${statusStats[0].total}`);

    console.log('\n✅ Enhanced demo seed completed!');
    console.log('\n📝 Test accounts:');
    console.log('   Admin:    admin@test.com / test123    → /superadmin');
    console.log('   Campaign: campaign@test.com / test123 → /admin');
    console.log('   User:     player@test.com / test123   → /bookings');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
