export interface SmtpConfig {
  service?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  fromEmail: string;
}

function readOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function getSmtpConfig(): SmtpConfig {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_EMAIL;

  if (!user || !pass || !fromEmail) {
    throw new Error('Missing SMTP_USER/SMTP_PASS/SMTP_EMAIL env vars');
  }

  // Optional overrides
  const service = process.env.SMTP_SERVICE;
  const host = process.env.SMTP_HOST;
  const port = readOptionalInt(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : undefined;

  // Dev default inside Docker: use Mailpit if SMTP isn't configured explicitly
  if (!host && !service && process.env.DOCKER === 'true') {
    return {
      host: 'mailpit',
      port: 1025,
      secure: false,
      user,
      pass,
      fromEmail
    };
  }

  // In Docker, SMTP_HOST=127.0.0.1/localhost almost always means "connect to myself", which will fail.
  // Allow only if explicitly enabled (e.g., you run a local SMTP relay inside the same container/network).
  if (
    host &&
    (host === '127.0.0.1' || host === 'localhost') &&
    process.env.SMTP_ALLOW_LOCALHOST !== 'true'
  ) {
    throw new Error(
      'SMTP_HOST is set to localhost (127.0.0.1). In Docker it points to the backend container itself. Set SMTP_HOST to your real SMTP server (e.g. smtp.gmail.com) or set SMTP_ALLOW_LOCALHOST=true if you really run SMTP on localhost.'
    );
  }

  // If host/service not provided, try to infer common providers from email domain
  if (!host && !service) {
    const domain = user.split('@')[1]?.toLowerCase() ?? '';
    if (domain === 'gmail.com') return { service: 'gmail', user, pass, fromEmail };
    if (domain.endsWith('yandex.ru') || domain.endsWith('ya.ru')) return { service: 'yandex', user, pass, fromEmail };
    if (domain === 'mail.ru' || domain.endsWith('.mail.ru')) return { service: 'mailru', user, pass, fromEmail };
    if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com') {
      return { service: 'hotmail', user, pass, fromEmail };
    }
  }

  if (!host && !service) {
    throw new Error('Missing SMTP_HOST/SMTP_PORT (or SMTP_SERVICE) env vars');
  }

  return { service, host, port, secure, user, pass, fromEmail };
}

