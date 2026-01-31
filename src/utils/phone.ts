/**
 * Нормализует номер телефона к формату 7XXXXXXXXXX (только цифры)
 * Примеры:
 *   "+7 (999) 123-45-67" -> "79991234567"
 *   "8 999 123 45 67"    -> "79991234567"
 *   "9991234567"         -> "79991234567"
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Убираем всё кроме цифр
  let digits = phone.replace(/\D/g, '');

  if (digits.length === 0) return null;

  // Если начинается с 8, заменяем на 7 (Россия)
  if (digits.startsWith('8') && digits.length === 11) {
    digits = '7' + digits.slice(1);
  }

  // Если 10 цифр (без кода страны), добавляем 7
  if (digits.length === 10) {
    digits = '7' + digits;
  }

  // Валидация: должно быть 11 цифр и начинаться с 7
  if (digits.length !== 11 || !digits.startsWith('7')) {
    // Возвращаем как есть если не удалось нормализовать
    // (для иностранных номеров или нестандартных форматов)
    return digits;
  }

  return digits;
}

/**
 * Форматирует телефон для отображения
 * "79991234567" -> "+7 (999) 123-45-67"
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  return phone;
}
