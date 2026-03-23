import { describe, it, expect } from 'vitest';
import {
  normalizeMediaShape,
  getMediaUrls,
  extractBucketKeyFromUrl,
  extractManagedMediaByBucket,
  applyPendingOverlay,
} from './campaign.helpers';
import type { Campaign } from '../model/campaign.model';

// ==================== NORMALIZE MEDIA SHAPE ====================

describe('normalizeMediaShape', () => {
  it('возвращает null для null', () => {
    expect(normalizeMediaShape(null)).toBeNull();
  });

  it('возвращает null для не-объекта', () => {
    expect(normalizeMediaShape('string')).toBeNull();
    expect(normalizeMediaShape(42)).toBeNull();
  });

  it('нормализует пустой объект', () => {
    expect(normalizeMediaShape({})).toEqual({
      main_src: '',
      description: '',
      extra_media: [],
    });
  });

  it('берёт main_src из photos если main_src не задан', () => {
    const result = normalizeMediaShape({ photos: ['a.jpg', 'b.jpg'] });
    expect(result!.main_src).toBe('a.jpg');
  });

  it('использует main_src если задан', () => {
    const result = normalizeMediaShape({ main_src: 'main.jpg', photos: ['a.jpg'] });
    expect(result!.main_src).toBe('main.jpg');
  });

  it('нормализует extra_media', () => {
    const result = normalizeMediaShape({
      extra_media: [
        { src: 'extra1.jpg', description: 'desc1' },
        { src: 'extra2.jpg' }, // без description
        null, // фильтруется
        'string', // фильтруется
      ],
    });
    expect(result!.extra_media).toHaveLength(2);
    expect(result!.extra_media[0]).toEqual({ src: 'extra1.jpg', description: 'desc1' });
    expect(result!.extra_media[1]).toEqual({ src: 'extra2.jpg', description: '' });
  });

  it('description по умолчанию пустая строка', () => {
    const result = normalizeMediaShape({});
    expect(result!.description).toBe('');
  });

  it('сохраняет описание если строка', () => {
    const result = normalizeMediaShape({ description: 'Фото площадки' });
    expect(result!.description).toBe('Фото площадки');
  });
});

// ==================== GET MEDIA URLS ====================

describe('getMediaUrls', () => {
  it('возвращает пустой массив для null', () => {
    expect(getMediaUrls(null)).toEqual([]);
  });

  it('извлекает main_src и extra_media urls', () => {
    const urls = getMediaUrls({
      main_src: 'https://cdn.example.com/main.jpg',
      description: '',
      extra_media: [
        { src: 'https://cdn.example.com/extra1.jpg', description: '' },
        { src: 'https://cdn.example.com/extra2.jpg', description: '' },
      ],
    });
    expect(urls).toHaveLength(3);
    expect(urls).toContain('https://cdn.example.com/main.jpg');
  });

  it('фильтрует пустые строки', () => {
    const urls = getMediaUrls({
      main_src: '',
      description: '',
      extra_media: [{ src: '', description: '' }],
    });
    expect(urls).toEqual([]);
  });
});

// ==================== EXTRACT BUCKET KEY FROM URL ====================

describe('extractBucketKeyFromUrl', () => {
  it('парсит proxy URL с /s3/public/', () => {
    const result = extractBucketKeyFromUrl('https://api.example.com/s3/public/sportbooking/images/photo.jpg');
    expect(result).toEqual({ bucket: 'sportbooking', key: 'images/photo.jpg' });
  });

  it('парсит direct URL (bucket/key)', () => {
    const result = extractBucketKeyFromUrl('https://minio.example.com/sportbooking/images/photo.jpg');
    expect(result).toEqual({ bucket: 'sportbooking', key: 'images/photo.jpg' });
  });

  it('декодирует URL-encoded символы', () => {
    const result = extractBucketKeyFromUrl('https://api.example.com/s3/public/sportbooking/images/photo%20name.jpg');
    expect(result).toEqual({ bucket: 'sportbooking', key: 'images/photo name.jpg' });
  });

  it('возвращает null для невалидного URL', () => {
    expect(extractBucketKeyFromUrl('not-a-url')).toBeNull();
  });

  it('возвращает null для URL без path', () => {
    expect(extractBucketKeyFromUrl('https://example.com/')).toBeNull();
  });

  it('возвращает null для URL с одним сегментом', () => {
    expect(extractBucketKeyFromUrl('https://example.com/onlybucket')).toBeNull();
  });

  it('парсит URL с несколькими сегментами key', () => {
    const result = extractBucketKeyFromUrl('https://cdn.example.com/bucket/a/b/c.jpg');
    expect(result).toEqual({ bucket: 'bucket', key: 'a/b/c.jpg' });
  });
});

// ==================== EXTRACT MANAGED MEDIA BY BUCKET ====================

describe('extractManagedMediaByBucket', () => {
  it('группирует URL по bucket, фильтрует images/', () => {
    const result = extractManagedMediaByBucket({
      main_src: 'https://api.example.com/s3/public/sportbooking/images/main.jpg',
      description: '',
      extra_media: [
        { src: 'https://api.example.com/s3/public/sportbooking/images/extra.jpg', description: '' },
        { src: 'https://api.example.com/s3/public/sportbooking/tmp/temp.jpg', description: '' }, // не images/ — фильтруется
      ],
    });
    expect(result.get('sportbooking')?.size).toBe(2);
    expect(result.get('sportbooking')?.has('images/main.jpg')).toBe(true);
    expect(result.get('sportbooking')?.has('images/extra.jpg')).toBe(true);
  });

  it('пустой media → пустой map', () => {
    const result = extractManagedMediaByBucket(null);
    expect(result.size).toBe(0);
  });
});

// ==================== APPLY PENDING OVERLAY ====================

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    user_id: 'user-1',
    name: 'Original Name',
    description: null,
    short_description: null,
    location: { city: 'Москва', street: 'Ленина', house: '1', coordinates: '55.7,37.6' },
    contacts: null,
    working_timetable: null,
    socials_links: null,
    payment_methods: null,
    facilities: null,
    media: null,
    booking_info: null,
    timezone_id: 'Europe/Moscow',
    status: 'published' as any,
    pending_changes: null,
    moderation_comment: null,
    moderation_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('applyPendingOverlay', () => {
  it('без pending_changes → кампания не изменена', () => {
    const campaign = makeCampaign();
    const result = applyPendingOverlay(campaign);
    expect(result.name).toBe('Original Name');
  });

  it('pending_changes.name → имя заменено', () => {
    const campaign = makeCampaign({
      pending_changes: { name: 'New Name' },
    });
    const result = applyPendingOverlay(campaign);
    expect(result.name).toBe('New Name');
  });

  it('pending_changes.location → location заменён', () => {
    const newLocation = { city: 'СПб', street: 'Невский', house: '10', coordinates: '59.9,30.3' };
    const campaign = makeCampaign({
      pending_changes: { location: newLocation },
    });
    const result = applyPendingOverlay(campaign);
    expect(result.location).toEqual(newLocation);
  });

  it('pending_changes.media → media нормализуется', () => {
    const campaign = makeCampaign({
      pending_changes: {
        media: { main_src: 'new.jpg', description: 'new desc', extra_media: [] },
      },
    });
    const result = applyPendingOverlay(campaign);
    expect(result.media).toEqual({
      main_src: 'new.jpg',
      description: 'new desc',
      extra_media: [],
    });
  });

  it('не мутирует оригинальный объект', () => {
    const campaign = makeCampaign({ pending_changes: { name: 'Changed' } });
    applyPendingOverlay(campaign);
    expect(campaign.name).toBe('Original Name');
  });
});
