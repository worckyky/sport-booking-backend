-- Seed data for development/testing
-- Run with: npm run seed

-- Clean existing data (in reverse order of dependencies)
TRUNCATE TABLE bookings, booking_slots, fields, password_reset_tokens, registration_links, invitations, users, campaign_info CASCADE;

-- =====================================================
-- 1. CAMPAIGN INFO (created first for foreign key)
-- =====================================================
INSERT INTO campaign_info (
  id,
  user_id,
  name,
  description,
  short_description,
  location,
  contacts,
  working_timetable,
  socials_links,
  payment_methods,
  facilities,
  media,
  booking_info,
  status
) VALUES (
  '550e8400-e29b-41d4-a716-446655440001',
  NULL, -- will be set after user creation
  'Спортивный комплекс "Арена"',
  'Современный спортивный комплекс в центре города с профессиональными кортами и залами. У нас вы найдете все необходимое для занятий спортом: футбольные поля с искусственным покрытием, баскетбольные корты, теннисные корты.',
  'Современный спортивный комплекс с профессиональными кортами',
  '{"city": "Москва", "address": "ул. Спортивная, д. 10", "coordinates": {"lat": 55.751244, "lon": 37.618423}}'::jsonb,
  '{"phone": "+7 (495) 123-45-67", "email": "info@arena-sport.ru"}'::jsonb,
  '{"monday": {"from": "08:00", "to": "23:00"}, "tuesday": {"from": "08:00", "to": "23:00"}, "wednesday": {"from": "08:00", "to": "23:00"}, "thursday": {"from": "08:00", "to": "23:00"}, "friday": {"from": "08:00", "to": "23:00"}, "saturday": {"from": "09:00", "to": "22:00"}, "sunday": {"from": "09:00", "to": "22:00"}}'::jsonb,
  '[{"type": "VK", "url": "https://vk.com/arena_sport"}, {"type": "TELEGRAM", "url": "https://t.me/arena_sport"}]'::jsonb,
  ARRAY['MONEY', 'CARD', 'SBP']::payment_method_type[],
  ARRAY['PARKING', 'SHOWER', 'LOCKER_ROOM', 'WIFI', 'LIGHTING', 'CAFE', 'RENTAL', 'VIDEO_SURVEILLANCE']::facility_type[],
  '{"photos": ["https://images.unsplash.com/photo-1556817411-31ae72fa3ea0", "https://images.unsplash.com/photo-1575361204480-aadea25e6e68"]}'::jsonb,
  'Вход со стороны главного входа. При первом посещении обратитесь к администратору. Не забудьте спортивную форму!',
  'published'
);

-- Second campaign
INSERT INTO campaign_info (
  id,
  user_id,
  name,
  description,
  short_description,
  location,
  contacts,
  working_timetable,
  socials_links,
  payment_methods,
  facilities,
  media,
  booking_info,
  status
) VALUES (
  '550e8400-e29b-41d4-a716-446655440002',
  NULL,
  'Теннисный клуб "Победа"',
  'Профессиональные теннисные корты с покрытием харт. Работаем круглый год. Есть крытые и открытые корты.',
  'Профессиональные теннисные корты',
  '{"city": "Москва", "address": "ул. Теннисная, д. 5", "coordinates": {"lat": 55.755244, "lon": 37.615423}}'::jsonb,
  '{"phone": "+7 (495) 987-65-43", "email": "info@pobeda-tennis.ru"}'::jsonb,
  '{"monday": {"from": "07:00", "to": "23:00"}, "tuesday": {"from": "07:00", "to": "23:00"}, "wednesday": {"from": "07:00", "to": "23:00"}, "thursday": {"from": "07:00", "to": "23:00"}, "friday": {"from": "07:00", "to": "23:00"}, "saturday": {"from": "08:00", "to": "23:00"}, "sunday": {"from": "08:00", "to": "23:00"}}'::jsonb,
  '[{"type": "WHATS_APP", "url": "https://wa.me/74959876543"}]'::jsonb,
  ARRAY['MONEY', 'CARD']::payment_method_type[],
  ARRAY['PARKING', 'SHOWER', 'LOCKER_ROOM', 'CAFE', 'RENTAL']::facility_type[],
  '{"photos": ["https://images.unsplash.com/photo-1622279457486-62dcc4a431d6"]}'::jsonb,
  'Ракетки можно взять в аренду на ресепшене. Мячи предоставляются.',
  'published'
);

-- =====================================================
-- 2. USERS
-- =====================================================
-- Password: test123 (bcrypt hash)
-- Salt rounds: 10
INSERT INTO users (
  id,
  email,
  password_hash,
  role,
  name,
  phone,
  email_verified,
  campaign_id,
  is_blocked
) VALUES
-- USER role
(
  '110e8400-e29b-41d4-a716-446655440001',
  'player@test.com',
  '$2b$10$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ', -- test123
  'USER',
  'Иван Петров',
  '+79161234567',
  'VERIFIED',
  NULL,
  false
),
-- CAMPAIGN role (owner of first campaign)
(
  '220e8400-e29b-41d4-a716-446655440002',
  'campaign@test.com',
  '$2b$10$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ', -- test123
  'CAMPAIGN',
  'Спортивный комплекс "Арена"',
  '+74951234567',
  'VERIFIED',
  '550e8400-e29b-41d4-a716-446655440001',
  false
),
-- Second CAMPAIGN (owner of second campaign)
(
  '220e8400-e29b-41d4-a716-446655440003',
  'campaign2@test.com',
  '$2b$10$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ', -- test123
  'CAMPAIGN',
  'Теннисный клуб "Победа"',
  '+74959876543',
  'VERIFIED',
  '550e8400-e29b-41d4-a716-446655440002',
  false
),
-- ADMIN role
(
  '330e8400-e29b-41d4-a716-446655440003',
  'admin@test.com',
  '$2b$10$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ', -- test123
  'ADMIN',
  'Администратор Системы',
  '+79167654321',
  'VERIFIED',
  NULL,
  false
),
-- Additional regular users
(
  '110e8400-e29b-41d4-a716-446655440002',
  'user2@test.com',
  '$2b$10$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ', -- test123
  'USER',
  'Мария Сидорова',
  '+79167777777',
  'VERIFIED',
  NULL,
  false
),
(
  '110e8400-e29b-41d4-a716-446655440003',
  'user3@test.com',
  '$2b$10$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ', -- test123
  'USER',
  'Алексей Иванов',
  '+79168888888',
  'NOT_VERIFIED',
  NULL,
  false
);

-- Update campaign_info with user_id
UPDATE campaign_info SET user_id = '220e8400-e29b-41d4-a716-446655440002' WHERE id = '550e8400-e29b-41d4-a716-446655440001';
UPDATE campaign_info SET user_id = '220e8400-e29b-41d4-a716-446655440003' WHERE id = '550e8400-e29b-41d4-a716-446655440002';

-- =====================================================
-- 3. FIELDS (кортов/залов для первой кампании)
-- =====================================================
INSERT INTO fields (
  id,
  campaign_id,
  name,
  price_per_hour,
  sport_types,
  working_timetable
) VALUES
-- Arena fields
(
  '660e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440001',
  'Футбольное поле #1',
  2000.00,
  ARRAY['FOOTBALL']::text[],
  NULL -- inherits from campaign
),
(
  '660e8400-e29b-41d4-a716-446655440002',
  '550e8400-e29b-41d4-a716-446655440001',
  'Футбольное поле #2',
  2000.00,
  ARRAY['FOOTBALL']::text[],
  NULL
),
(
  '660e8400-e29b-41d4-a716-446655440003',
  '550e8400-e29b-41d4-a716-446655440001',
  'Баскетбольный корт',
  1500.00,
  ARRAY['BASKETBALL']::text[],
  '{"monday": {"from": "10:00", "to": "22:00", "breaks": [{"from": "13:00", "to": "14:00", "reason": "Технический перерыв"}]}}'::jsonb
),
(
  '660e8400-e29b-41d4-a716-446655440004',
  '550e8400-e29b-41d4-a716-446655440001',
  'Теннисный корт #1',
  1000.00,
  ARRAY['TENNIS']::text[],
  NULL
),
-- Pobeda fields
(
  '660e8400-e29b-41d4-a716-446655440005',
  '550e8400-e29b-41d4-a716-446655440002',
  'Корт #1 (крытый)',
  1500.00,
  ARRAY['TENNIS']::text[],
  NULL
),
(
  '660e8400-e29b-41d4-a716-446655440006',
  '550e8400-e29b-41d4-a716-446655440002',
  'Корт #2 (открытый)',
  1200.00,
  ARRAY['TENNIS']::text[],
  NULL
);

-- =====================================================
-- 4. BOOKING SLOTS (for next 7 days)
-- =====================================================
-- Generate slots for Football field #1 (today + 3 days)
INSERT INTO booking_slots (id, field_id, date, start_time, end_time)
SELECT
  gen_random_uuid(),
  '660e8400-e29b-41d4-a716-446655440001',
  CURRENT_DATE + d.day,
  t.hour::time,
  (t.hour + interval '1 hour')::time
FROM
  generate_series(0, 3) AS d(day),
  generate_series(timestamp '2024-01-01 08:00', timestamp '2024-01-01 22:00', interval '1 hour') AS t(hour);

-- Generate slots for Tennis court (today + 3 days)
INSERT INTO booking_slots (id, field_id, date, start_time, end_time)
SELECT
  gen_random_uuid(),
  '660e8400-e29b-41d4-a716-446655440004',
  CURRENT_DATE + d.day,
  t.hour::time,
  (t.hour + interval '1 hour')::time
FROM
  generate_series(0, 3) AS d(day),
  generate_series(timestamp '2024-01-01 08:00', timestamp '2024-01-01 22:00', interval '1 hour') AS t(hour);

-- =====================================================
-- 5. BOOKINGS (sample bookings)
-- =====================================================
-- Create some confirmed bookings for user 1 (today)
INSERT INTO bookings (id, slot_id, user_id, status, contact_name, contact_phone)
SELECT
  gen_random_uuid(),
  bs.id,
  '110e8400-e29b-41d4-a716-446655440001',
  'confirmed',
  'Иван Петров',
  '+79161234567'
FROM booking_slots bs
WHERE bs.field_id = '660e8400-e29b-41d4-a716-446655440001'
  AND bs.date = CURRENT_DATE
  AND bs.start_time IN ('10:00', '11:00', '14:00')
LIMIT 3;

-- Create pending booking for user 2 (tomorrow)
INSERT INTO bookings (id, slot_id, user_id, status, contact_name, contact_phone)
SELECT
  gen_random_uuid(),
  bs.id,
  '110e8400-e29b-41d4-a716-446655440002',
  'pending',
  'Мария Сидорова',
  '+79167777777'
FROM booking_slots bs
WHERE bs.field_id = '660e8400-e29b-41d4-a716-446655440004'
  AND bs.date = CURRENT_DATE + 1
  AND bs.start_time = '16:00'
LIMIT 1;

-- Create confirmed booking for user 3 (day after tomorrow)
INSERT INTO bookings (id, slot_id, user_id, status, contact_name, contact_phone)
SELECT
  gen_random_uuid(),
  bs.id,
  '110e8400-e29b-41d4-a716-446655440003',
  'confirmed',
  'Алексей Иванов',
  '+79168888888'
FROM booking_slots bs
WHERE bs.field_id = '660e8400-e29b-41d4-a716-446655440001'
  AND bs.date = CURRENT_DATE + 2
  AND bs.start_time = '18:00'
LIMIT 1;

-- =====================================================
-- Summary
-- =====================================================
DO $$
DECLARE
  user_count INT;
  campaign_count INT;
  field_count INT;
  slot_count INT;
  booking_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM users;
  SELECT COUNT(*) INTO campaign_count FROM campaign_info;
  SELECT COUNT(*) INTO field_count FROM fields;
  SELECT COUNT(*) INTO slot_count FROM booking_slots;
  SELECT COUNT(*) INTO booking_count FROM bookings;

  RAISE NOTICE '✅ Seed data created successfully!';
  RAISE NOTICE '   Users: %', user_count;
  RAISE NOTICE '   Campaigns: %', campaign_count;
  RAISE NOTICE '   Fields: %', field_count;
  RAISE NOTICE '   Slots: %', slot_count;
  RAISE NOTICE '   Bookings: %', booking_count;
END $$;

-- =====================================================
-- REGISTRATION LINKS (тестовая ссылка для регистрации площадки)
-- =====================================================
-- Token: test-registration-token-12345
-- URL: /auth/register-campaign?token=test-registration-token-12345
INSERT INTO registration_links (
  id,
  token_hash,
  created_by,
  expires_at
) VALUES (
  '660e8400-e29b-41d4-a716-446655440001',
  'b9ac56ad8da5de71fb8068f4cbec22f330612d8db822406760c15ebae97f1f47',
  '330e8400-e29b-41d4-a716-446655440003', -- admin@test.com
  NOW() + INTERVAL '7 days'
);
