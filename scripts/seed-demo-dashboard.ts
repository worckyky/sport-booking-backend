/**
 * Seed скрипт для генерации демо-данных для дашборда
 *
 * Генерирует:
 * - Обновляет существующую площадку campaign@test.com
 * - 5 полей
 * - ~300 клиентов (200 зарегистрированных + 100 гостей)
 * - ~2000+ бронирований за 74 дня (60 назад + 14 вперёд)
 *
 * Запуск: npx ts-node scripts/seed-demo-dashboard.ts
 */

import { Pool } from 'pg';
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

// ===== CONFIG =====
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sport_booking';
const pool = new Pool({ connectionString: DATABASE_URL });

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

const FIELDS: FieldConfig[] = [
  { name: 'Футбольное поле №1', sport: 'FOOTBALL', indoor: false, price: 2000, duration: 60, fromHour: 8, toHour: 22, sundayOff: false, info: 'Натуральный газон, размер 60×40м. Мячи в аренду на ресепшен.' },
  { name: 'Футбольное поле №2', sport: 'FOOTBALL', indoor: false, price: 1800, duration: 60, fromHour: 8, toHour: 22, sundayOff: true, info: 'Искусственный газон, размер 40×25м. Освещение включено в стоимость.' },
  { name: 'Теннисный корт', sport: 'TENNIS', indoor: true, price: 1500, duration: 60, fromHour: 9, toHour: 21, sundayOff: false, info: 'Хард-покрытие, крытый. Ракетки и мячи в аренду.' },
  { name: 'Баскетбольная площадка', sport: 'BASKETBALL', indoor: false, price: 1200, duration: 60, fromHour: 10, toHour: 21, sundayOff: false, info: 'Открытая площадка с профессиональными кольцами.' },
  { name: 'Мини-футбол (крытый)', sport: 'FOOTBALL', indoor: true, price: 2500, duration: 90, fromHour: 8, toHour: 23, sundayOff: false, info: 'Крытый зал с подогревом. Размер 30×15м. Работает круглый год.' },
];

// Распределение бронирований по часам (weighted)
const HOUR_WEIGHTS: Record<number, number> = {
  8: 2, 9: 3, 10: 5, 11: 6, 12: 5, 13: 4, 14: 4,
  15: 6, 16: 7, 17: 10, 18: 12, 19: 10, 20: 8, 21: 6, 22: 3,
};

// Распределение по дням недели (0 = Monday)
const DOW_WEIGHTS = [5, 5, 6, 6, 7, 12, 10]; // Пн-Вс

// Распределение по статусам
const STATUS_DISTRIBUTION: Record<string, number> = {
  completed: 0.55,
  confirmed: 0.20,
  pending: 0.05,
  cancelled_by_client: 0.08,
  no_show: 0.05,
  expired: 0.04,
  rejected: 0.03,
};

const BOOKING_COMMENTS = [
  'Принесём свои мячи', 'Будет 10 человек', 'Нужна сетка', 'Можно прийти на 10 мин раньше?',
  'Играем в мини-футбол', 'Празднуем день рождения', 'Тренировка команды', 'Нужен свет',
  'Бронирую на 2 часа подряд', 'Будут дети, нужны маленькие ворота',
  null, null, null, null, null, null, null, null, null, null, // 2/3 без комментария
];

// ===== HELPERS =====
function uuid(): string {
  return crypto.randomUUID();
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone(): string {
  const digits = Math.floor(Math.random() * 900000000) + 100000000;
  return `79${digits}`;
}

let emailCounter = 0;
function randomEmail(name: string, lastname: string): string {
  const domains = ['gmail.com', 'yandex.ru', 'mail.ru', 'outlook.com'];
  emailCounter++;
  return `${name.toLowerCase()}.${lastname.toLowerCase()}${emailCounter}@${randomElement(domains)}`;
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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

function dateToString(date: Date): string {
  return date.toISOString().split('T')[0];
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

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Возвращает допустимые часы начала для поля */
function getFieldHours(field: FieldConfig): number[] {
  const hours: number[] = [];
  const slotsPerHour = field.duration / 60;
  for (let h = field.fromHour; h + slotsPerHour <= field.toHour; h++) {
    hours.push(h);
  }
  return hours;
}

/** Создаёт дату с учётом weighted day of week */
function generateWeightedDate(startDate: Date, endDate: Date): Date {
  // Сначала случайная дата, потом проверяем вес дня недели
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  for (let attempt = 0; attempt < 20; attempt++) {
    const dayOffset = Math.floor(Math.random() * totalDays);
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);
    const dow = date.getDay() === 0 ? 6 : date.getDay() - 1; // 0=Mon, 6=Sun
    // Accept with probability proportional to weight
    if (Math.random() * 12 < DOW_WEIGHTS[dow]) {
      return date;
    }
  }
  // Fallback
  const dayOffset = Math.floor(Math.random() * totalDays);
  const date = new Date(startDate);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

// ===== MAIN =====
async function main() {
  console.log('🌱 Starting demo dashboard seed...\n');

  try {
    // 1. Используем существующую площадку campaign@test.com
    console.log('1️⃣  Looking up existing campaign (campaign@test.com)...');

    const campaignId = '550e8400-e29b-41d4-a716-446655440001';

    const { rows } = await pool.query('SELECT id, name FROM campaign_info WHERE id = $1', [campaignId]);
    if (rows.length === 0) {
      throw new Error('Campaign not found! Run base seed first: npx ts-node src/scripts/seed.ts');
    }
    console.log(`   ✅ Found campaign: ${rows[0].name} (${campaignId})`);

    // Обновляем площадку (sports удалена в миграции 010 — вычисляется из fields.sport_types)
    await pool.query(`
      UPDATE campaign_info SET
        name = $1,
        description = $2,
        short_description = $3,
        location = $4,
        contacts = $5,
        working_timetable = $6,
        socials_links = $7,
        payment_methods = $8,
        facilities = $9,
        booking_info = $10,
        timezone_id = $11
      WHERE id = $12
    `, [
      'СпортПарк Казань',
      'Современный спортивный комплекс с открытыми и крытыми площадками для футбола, тенниса и баскетбола. 5 полей, парковка, раздевалки, кафе.',
      'Футбол, теннис, баскетбол — всё в одном месте',
      JSON.stringify({ city: 'Казань', address: 'ул. Спортивная, 15', lat: 55.7887, lng: 49.1221 }),
      JSON.stringify({ phone: '79991234567', email: 'arena@demo.ru' }),
      JSON.stringify({
        monday: { from: '08:00', to: '23:00' },
        tuesday: { from: '08:00', to: '23:00' },
        wednesday: { from: '08:00', to: '23:00' },
        thursday: { from: '08:00', to: '23:00' },
        friday: { from: '08:00', to: '23:00' },
        saturday: { from: '08:00', to: '23:00' },
        sunday: { from: '09:00', to: '22:00' },
      }),
      JSON.stringify([
        { type: 'VK', url: 'https://vk.com/arena_kazan' },
        { type: 'TELEGRAM', url: 'https://t.me/arena_kazan' },
      ]),
      ['MONEY', 'CARD', 'SBP'],
      ['PARKING', 'SHOWER', 'LOCKER_ROOM', 'WIFI', 'LIGHTING', 'CAFE', 'RENTAL'],
      'Вход со стороны ул. Спортивная. Парковка бесплатная. Раздевалки на 1 этаже.',
      'Europe/Moscow',
      campaignId,
    ]);

    console.log('   ✅ Campaign updated with full demo data');

    // Удаляем старые данные (CASCADE: fields → booking_slots → bookings)
    console.log('   🗑️  Cleaning old fields/bookings...');
    await pool.query('DELETE FROM fields WHERE campaign_id = $1', [campaignId]);
    console.log('   ✅ Old data cleaned');

    const passwordHash = await hashPassword('demo123');

    // 2. Создаём поля
    console.log('\n2️⃣  Creating fields...');
    const fieldIds: string[] = [];

    for (const field of FIELDS) {
      const fieldId = uuid();
      fieldIds.push(fieldId);

      const makeDaySchedule = (from: string, to: string) => ({ from, to, breaks: [] });
      const fromStr = `${pad2(field.fromHour)}:00`;
      const toStr = `${pad2(field.toHour)}:00`;

      const timetable: Record<string, object | null> = {
        monday: makeDaySchedule(fromStr, toStr),
        tuesday: makeDaySchedule(fromStr, toStr),
        wednesday: makeDaySchedule(fromStr, toStr),
        thursday: makeDaySchedule(fromStr, toStr),
        friday: makeDaySchedule(fromStr, toStr),
        saturday: makeDaySchedule(fromStr, toStr),
        sunday: field.sundayOff ? null : makeDaySchedule(fromStr, toStr),
      };

      await pool.query(`
        INSERT INTO fields (
          id, campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
          status, slot_duration, working_timetable, client_info, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, NOW())
      `, [
        fieldId,
        campaignId,
        field.name,
        [field.sport],
        field.indoor,
        [`https://via.placeholder.com/800x600?text=${encodeURIComponent(field.name)}`],
        field.price,
        field.duration,
        JSON.stringify(timetable),
        field.info,
      ]);

      console.log(`   ✅ ${field.name} (${fromStr}-${toStr}, ${field.duration}мин, ${field.price}₽)`);
    }

    // 3. Создаём клиентов
    console.log('\n3️⃣  Creating users...');
    const registeredUsers: Array<{ id: string; name: string; phone: string }> = [];
    const guestPhones: string[] = [];

    // Зарегистрированные (200)
    for (let i = 0; i < 200; i++) {
      const userId = uuid();
      const firstName = randomElement(FIRST_NAMES);
      const lastName = randomElement(LAST_NAMES);
      const name = `${firstName} ${lastName}`;
      const phone = randomPhone();
      const email = randomEmail(firstName, lastName);

      await pool.query(`
        INSERT INTO users (id, email, password_hash, role, name, phone, created_at, updated_at)
        VALUES ($1, $2, $3, 'USER', $4, $5, NOW(), NOW())
      `, [userId, email, passwordHash, name, phone]);

      registeredUsers.push({ id: userId, name, phone });
    }

    // Гости (100)
    for (let i = 0; i < 100; i++) {
      guestPhones.push(randomPhone());
    }

    console.log(`   ✅ Created ${registeredUsers.length} registered users`);
    console.log(`   ✅ Generated ${guestPhones.length} guest phones`);

    // 4. Распределение клиентов по частоте
    console.log('\n4️⃣  Distributing booking frequency...');

    interface ClientFreq {
      userId: string | null;
      phone: string;
      name: string;
      bookings: number;
    }

    const clientFrequency: ClientFreq[] = [];

    // Одноразовые: 80 зарег (= 80 бронирований)
    for (let i = 0; i < 80; i++) {
      const user = registeredUsers[i];
      clientFrequency.push({ userId: user.id, phone: user.phone, name: user.name, bookings: 1 });
    }

    // Пришли 2-4 раза: 60 зарег (= ~180)
    for (let i = 80; i < 140; i++) {
      const user = registeredUsers[i];
      const bookings = 2 + Math.floor(Math.random() * 3);
      clientFrequency.push({ userId: user.id, phone: user.phone, name: user.name, bookings });
    }

    // Периодические 5-8 раз: 40 зарег + 30 гостей (= ~455)
    for (let i = 140; i < 180; i++) {
      const user = registeredUsers[i];
      const bookings = 5 + Math.floor(Math.random() * 4);
      clientFrequency.push({ userId: user.id, phone: user.phone, name: user.name, bookings });
    }
    for (let i = 0; i < 30; i++) {
      const phone = guestPhones[i];
      const name = `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`;
      const bookings = 5 + Math.floor(Math.random() * 4);
      clientFrequency.push({ userId: null, phone, name, bookings });
    }

    // Регулярные 10-15 раз: 20 зарег + 40 гостей (= ~750)
    for (let i = 180; i < 200; i++) {
      const user = registeredUsers[i];
      const bookings = 10 + Math.floor(Math.random() * 6);
      clientFrequency.push({ userId: user.id, phone: user.phone, name: user.name, bookings });
    }
    for (let i = 30; i < 70; i++) {
      const phone = guestPhones[i];
      const name = `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`;
      const bookings = 10 + Math.floor(Math.random() * 6);
      clientFrequency.push({ userId: null, phone, name, bookings });
    }

    // Постоянные 16-22 раза: 30 гостей (= ~570)
    for (let i = 70; i < 100; i++) {
      const phone = guestPhones[i];
      const name = `${randomElement(FIRST_NAMES)} ${randomElement(LAST_NAMES)}`;
      const bookings = 16 + Math.floor(Math.random() * 7);
      clientFrequency.push({ userId: null, phone, name, bookings });
    }

    const expectedTotal = clientFrequency.reduce((sum, c) => sum + c.bookings, 0);
    console.log(`   ✅ ${clientFrequency.length} clients, ~${expectedTotal} expected bookings`);

    // 5. Генерируем бронирования
    console.log('\n5️⃣  Creating bookings...');

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 60);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    // Track occupied slots to avoid UNIQUE conflicts
    const occupiedSlots = new Set<string>(); // "fieldIdx:date:hour"

    let totalBookings = 0;
    let skippedDuplicates = 0;
    let platformCount = 0;
    let manualCount = 0;

    for (const client of clientFrequency) {
      // Client "first appearance" — frequent clients from the start, one-time from recent
      // This creates natural growth trend in the dashboard
      const recencyBias = Math.max(0, 1 - client.bookings / 15); // 1 for one-timers, 0 for regulars
      const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const earliestDay = Math.floor(totalDays * recencyBias * 0.6); // one-timers start from ~60% of range
      const clientStartDate = new Date(startDate);
      clientStartDate.setDate(clientStartDate.getDate() + earliestDay);

      for (let i = 0; i < client.bookings; i++) {
        // Pick a date with weighted DOW, within client's range
        const bookingDate = generateWeightedDate(clientStartDate, endDate);
        const dateStr = dateToString(bookingDate);
        const dow = bookingDate.getDay() === 0 ? 6 : bookingDate.getDay() - 1; // 0=Mon, 6=Sun

        // Pick a field (skip field №2 on Sunday)
        let fieldIdx: number;
        let attempts = 0;
        do {
          fieldIdx = Math.floor(Math.random() * FIELDS.length);
          attempts++;
        } while (FIELDS[fieldIdx].sundayOff && dow === 6 && attempts < 10);

        if (FIELDS[fieldIdx].sundayOff && dow === 6) {
          fieldIdx = 0; // fallback to field №1
        }

        const field = FIELDS[fieldIdx];
        const fieldId = fieldIds[fieldIdx];

        // Pick a valid hour for this field (weighted)
        const validHours = getFieldHours(field);
        const fieldHourWeights: Record<number, number> = {};
        for (const h of validHours) {
          if (HOUR_WEIGHTS[h]) {
            fieldHourWeights[h] = HOUR_WEIGHTS[h];
          }
        }

        if (Object.keys(fieldHourWeights).length === 0) continue;
        const hour = weightedRandom(fieldHourWeights);

        // Check for slot collision
        const slotKey = `${fieldIdx}:${dateStr}:${hour}`;
        if (occupiedSlots.has(slotKey)) {
          skippedDuplicates++;
          continue;
        }
        occupiedSlots.add(slotKey);

        const startTime = `${pad2(hour)}:00`;
        const endMinutes = hour * 60 + field.duration;
        const endTime = `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;

        // Status depends on date (compare dates only, not timestamps)
        let status: string;
        const bookingDateStr = dateToString(bookingDate);
        const todayStr = dateToString(now);
        if (bookingDateStr > todayStr) {
          // Future dates: pending or confirmed
          status = Math.random() < 0.75 ? 'confirmed' : 'pending';
        } else if (bookingDateStr === todayStr) {
          // Today: future slots get confirmed/pending, past slots get weighted status
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          if (endMinutes > nowMinutes) {
            status = Math.random() < 0.75 ? 'confirmed' : 'pending';
          } else {
            status = getWeightedStatus();
            if (['pending', 'confirmed'].includes(status)) {
              status = 'completed';
            }
          }
        } else {
          // Past dates
          status = getWeightedStatus();
          if (['pending', 'confirmed'].includes(status)) {
            status = 'completed';
          }
        }

        // created_at should be realistic: booking created 1-7 days before the slot date
        const daysBeforeSlot = 1 + Math.floor(Math.random() * 7);
        const createdAt = new Date(bookingDate);
        createdAt.setDate(createdAt.getDate() - daysBeforeSlot);
        // But not before our start date
        if (createdAt < startDate) {
          createdAt.setTime(startDate.getTime());
        }
        const createdAtStr = createdAt.toISOString();

        // Create slot
        const slotId = uuid();
        await pool.query(`
          INSERT INTO booking_slots (id, field_id, date, start_time, end_time, is_blocked, created_at)
          VALUES ($1, $2, $3, $4, $5, false, $6)
        `, [slotId, fieldId, dateStr, startTime, endTime, createdAtStr]);

        // Create booking
        const bookingId = uuid();
        const comment = randomElement(BOOKING_COMMENTS);
        await pool.query(`
          INSERT INTO bookings (
            id, slot_id, user_id, status, comment, contact_name, contact_phone,
            field_name, field_price, sport_type, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          bookingId,
          slotId,
          client.userId,
          status,
          comment,
          client.name,
          client.phone,
          field.name,
          field.price,
          field.sport,
          createdAtStr,
        ]);

        totalBookings++;
        if (client.userId) platformCount++;
        else manualCount++;
      }
    }

    // Stats
    const { rows: monthStats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE bs.date >= date_trunc('month', CURRENT_DATE)) as current_month,
        COUNT(*) FILTER (WHERE bs.date >= date_trunc('month', CURRENT_DATE) - interval '1 month'
                         AND bs.date < date_trunc('month', CURRENT_DATE)) as prev_month
      FROM bookings b
      JOIN booking_slots bs ON b.slot_id = bs.id
      JOIN fields f ON bs.field_id = f.id
      WHERE f.campaign_id = $1
    `, [campaignId]);

    const currMonth = parseInt(monthStats[0].current_month);
    const prevMonth = parseInt(monthStats[0].prev_month);
    const trend = prevMonth > 0 ? ((currMonth - prevMonth) / prevMonth * 100).toFixed(1) : 'N/A';

    console.log(`\n   ✅ Created ${totalBookings} bookings (${skippedDuplicates} skipped due to slot conflicts)`);
    console.log(`   📊 Platform: ${platformCount} | Manual: ${manualCount}`);
    console.log(`   📊 Previous month: ${prevMonth}`);
    console.log(`   📊 Current month: ${currMonth}`);
    console.log(`   📈 Trend: ${trend}%`);

    console.log('\n✅ Seed completed successfully!');
    console.log(`\n📝 Login as: campaign@test.com / test123`);
    console.log(`   Dashboard: http://localhost:3000/admin`);

  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
