/**
 * Pure business logic extracted from CampaignAPI for testability.
 * No DB calls, no side effects.
 */
import type { Campaign } from '../model/campaign.model';

// ==================== MEDIA NORMALIZATION ====================

export function normalizeMediaShape(media: unknown): Campaign['media'] {
  if (!media || typeof media !== 'object') return null;

  const src = media as Record<string, unknown>;
  const photos = Array.isArray(src.photos)
    ? src.photos.filter((p): p is string => typeof p === 'string')
    : [];
  const mainSrc = typeof src.main_src === 'string'
    ? src.main_src
    : (photos[0] || '');
  const description = typeof src.description === 'string' ? src.description : '';
  const extra = Array.isArray(src.extra_media)
    ? src.extra_media
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        src: typeof item.src === 'string' ? item.src : '',
        description: typeof item.description === 'string' ? item.description : '',
      }))
    : [];

  return {
    main_src: mainSrc,
    description,
    extra_media: extra,
  };
}

// ==================== MEDIA URL EXTRACTION ====================

export function getMediaUrls(media: Campaign['media']): string[] {
  const normalized = normalizeMediaShape(media);
  if (!normalized) return [];

  return [
    normalized.main_src || '',
    ...(normalized.extra_media || []).map((item) => item.src || ''),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

// ==================== S3 URL PARSING ====================

export function extractBucketKeyFromUrl(url: string): { bucket: string; key: string } | null {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname || '');
    const proxyMarker = '/s3/public/';
    const proxyIndex = path.indexOf(proxyMarker);
    if (proxyIndex >= 0) {
      const rest = path.slice(proxyIndex + proxyMarker.length);
      const slashIndex = rest.indexOf('/');
      if (slashIndex > 0 && slashIndex < rest.length - 1) {
        return {
          bucket: rest.slice(0, slashIndex),
          key: rest.slice(slashIndex + 1),
        };
      }
    }

    const directParts = path.split('/').filter(Boolean);
    if (directParts.length >= 2) {
      return {
        bucket: directParts[0],
        key: directParts.slice(1).join('/'),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ==================== MANAGED MEDIA BY BUCKET ====================

export function extractManagedMediaByBucket(media: Campaign['media']): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const parsed = getMediaUrls(media)
    .map((url) => extractBucketKeyFromUrl(url))
    .filter((item): item is { bucket: string; key: string } => item !== null)
    .filter((item) => item.key.startsWith('images/'));

  for (const item of parsed) {
    if (!map.has(item.bucket)) {
      map.set(item.bucket, new Set());
    }
    map.get(item.bucket)!.add(item.key);
  }

  return map;
}

// ==================== PENDING OVERLAY ====================

export function applyPendingOverlay(campaign: Campaign): Campaign {
  const pending = campaign.pending_changes;
  if (!pending || typeof pending !== 'object') {
    return campaign;
  }

  const result: Campaign = { ...campaign };
  const pendingObj = pending as Record<string, unknown>;

  if (typeof pendingObj.name === 'string') {
    result.name = pendingObj.name;
  }
  if (pendingObj.location && typeof pendingObj.location === 'object') {
    result.location = pendingObj.location as Campaign['location'];
  }
  if (pendingObj.media && typeof pendingObj.media === 'object') {
    result.media = normalizeMediaShape(pendingObj.media);
  }

  return result;
}
