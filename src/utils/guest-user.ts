import { PoolClient } from 'pg';
import crypto from 'crypto';
import { normalizePhone } from './phone';

/**
 * Находит или создаёт гостевого пользователя по телефону
 *
 * Гостевой аккаунт:
 * - phone: нормализованный номер (7XXXXXXXXXX)
 * - email: NULL
 * - password_hash: NULL
 * - name: NULL (берётся из bookings.contact_name при отображении)
 * - role: USER
 *
 * Защита от race condition:
 * - SELECT FOR UPDATE блокирует строку в транзакции
 * - Если два запроса одновременно создают гостя с одним телефоном,
 *   второй будет ждать первого и затем найдёт уже созданную запись
 *
 * @param client - PoolClient из withTransaction()
 * @param contactPhone - raw телефон (будет нормализован)
 * @returns userId - UUID гостевого пользователя
 * @throws Error если телефон невалидный
 *
 * @example
 * ```typescript
 * await withTransaction(async (client) => {
 *   const userId = await findOrCreateGuestUserInTransaction(client, '+7 999 123-45-67');
 *   await client.query('INSERT INTO bookings (user_id, ...) VALUES ($1, ...)', [userId]);
 * });
 * ```
 */
export async function findOrCreateGuestUserInTransaction(
  client: PoolClient,
  contactPhone: string
): Promise<string> {
  const normalizedPhone = normalizePhone(contactPhone);

  if (!normalizedPhone) {
    throw new Error('Invalid phone number format');
  }

  // SELECT FOR UPDATE — блокирует строку в транзакции (race condition protection)
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users
     WHERE phone = $1 AND email IS NULL
     FOR UPDATE`,
    [normalizedPhone]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Создать guest user
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  const result = await client.query<{ id: string }>(
    `INSERT INTO users (id, email, password_hash, role, name, phone, created_at, updated_at)
     VALUES ($1, NULL, NULL, 'USER', NULL, $2, $3, $4)
     RETURNING id`,
    [userId, normalizedPhone, now, now]
  );

  return result.rows[0].id;
}
