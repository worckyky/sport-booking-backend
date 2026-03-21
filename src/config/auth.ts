import type { CookieOptions } from 'express';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Missing JWT_SECRET env var');
  }
  return secret;
}

export const AUTH_COOKIE_NAME = 'auth_token';
export const AUTH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Cookie options for auth token.
 * In production with COOKIE_DOMAIN=.walknplay.ru, cookie is shared across subdomains
 * so Next.js middleware on walknplay.ru can read it from api.walknplay.ru responses.
 */
export function getAuthCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const options: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'lax' : 'strict',
    maxAge: AUTH_TOKEN_TTL_SECONDS * 1000,
  };

  if (process.env.COOKIE_DOMAIN) {
    options.domain = process.env.COOKIE_DOMAIN;
  }

  return options;
}

/** Cookie options for clearCookie (no maxAge needed). */
export function getClearCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const options: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'lax' : 'strict',
  };

  if (process.env.COOKIE_DOMAIN) {
    options.domain = process.env.COOKIE_DOMAIN;
  }

  return options;
}

