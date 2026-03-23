import { describe, it, expect } from 'vitest';
import { assertSafeIdentifier, quoteIdentifier, parseSelect } from './sql';

describe('assertSafeIdentifier', () => {
  it('принимает snake_case', () => {
    expect(() => assertSafeIdentifier('field_name', 'col')).not.toThrow();
  });

  it('принимает camelCase', () => {
    expect(() => assertSafeIdentifier('fieldName', 'col')).not.toThrow();
  });

  it('принимает schema.table', () => {
    expect(() => assertSafeIdentifier('public.users', 'table')).not.toThrow();
  });

  it('принимает идентификатор с цифрами', () => {
    expect(() => assertSafeIdentifier('field123', 'col')).not.toThrow();
  });

  it('отклоняет SQL injection', () => {
    expect(() => assertSafeIdentifier("'; DROP TABLE", 'col')).toThrow('Invalid col');
  });

  it('отклоняет начинающийся с цифры', () => {
    expect(() => assertSafeIdentifier('123abc', 'col')).toThrow('Invalid col');
  });

  it('отклоняет пустую строку', () => {
    expect(() => assertSafeIdentifier('', 'col')).toThrow('Invalid col');
  });

  it('отклоняет пробелы', () => {
    expect(() => assertSafeIdentifier('field name', 'col')).toThrow('Invalid col');
  });

  it('отклоняет спецсимволы', () => {
    expect(() => assertSafeIdentifier('field;name', 'col')).toThrow('Invalid col');
  });

  it('отклоняет тройную точку (a.b.c)', () => {
    expect(() => assertSafeIdentifier('a.b.c', 'col')).toThrow('Invalid col');
  });
});

describe('quoteIdentifier', () => {
  it('оборачивает простой идентификатор в кавычки', () => {
    expect(quoteIdentifier('field_name')).toBe('"field_name"');
  });

  it('оборачивает schema.table', () => {
    expect(quoteIdentifier('public.users')).toBe('"public"."users"');
  });

  it('экранирует кавычки внутри идентификатора', () => {
    expect(quoteIdentifier('fie"ld')).toBe('"fie""ld"');
  });
});

describe('parseSelect', () => {
  it('возвращает ["*"] для звёздочки', () => {
    expect(parseSelect('*')).toEqual(['*']);
  });

  it('возвращает ["*"] для пустой строки', () => {
    expect(parseSelect('')).toEqual(['*']);
  });

  it('возвращает ["*"] для строки с пробелами', () => {
    expect(parseSelect('   ')).toEqual(['*']);
  });

  it('парсит список полей через запятую', () => {
    expect(parseSelect('id,name,status')).toEqual(['id', 'name', 'status']);
  });

  it('убирает пробелы вокруг полей', () => {
    expect(parseSelect(' id , name , status ')).toEqual(['id', 'name', 'status']);
  });

  it('фильтрует пустые элементы', () => {
    expect(parseSelect('id,,name')).toEqual(['id', 'name']);
  });

  it('возвращает ["*"] для строки только из запятых', () => {
    expect(parseSelect(',,,')).toEqual(['*']);
  });
});
