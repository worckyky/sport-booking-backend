export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Missing JWT_SECRET env var');
  }
  return secret;
}

export const AUTH_COOKIE_NAME = 'auth_token';
export const AUTH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

