import express, { Request, Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger.config';
import { AuthRoutes } from './authentication/routes/auth.routes';
import { createInvitationRoutes } from './authentication/routes/invitation.routes';
import { createRegistrationLinkRoutes } from './authentication/routes/registration-link.routes';
import createCampaignRoutes from './campaign/routes/campaign.routes';
import createBookingRoutes from './booking/routes/booking.routes';
import { createAuditRoutes } from './audit/audit.routes';
import { getJwtSecret } from './config/auth';
import { getDbPool } from './config/db';
import { runMigrations } from './scripts/migrations';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
// Security headers
app.use(helmet());
// Response compression
app.use(compression());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // In production, reject requests without Origin header (security)
    // In dev, allow for Postman/curl/Swagger
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('Origin header required'));
      }
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Types
interface HealthResponse {
  status: string;
  timestamp: string;
}

async function start(): Promise<void> {
  // Database + Auth config (fail fast)
  getJwtSecret();
  const db = getDbPool();

  // Apply DB migrations on startup
  await runMigrations(db);

  // Initialize routes
  const authRoutes = new AuthRoutes(db);
  const invitationRoutes = createInvitationRoutes(db);
  const registrationLinkRoutes = createRegistrationLinkRoutes(db);
  const campaignRoutes = createCampaignRoutes(db);
  const bookingRoutes = createBookingRoutes(db);

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve);
  app.get('/api-docs', swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Sport Booking API Docs'
  }));

  // Rate limiting (disabled in development)
  const isDev = process.env.NODE_ENV !== 'production';
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDev ? 10000 : 500, // virtually unlimited in dev, 500 in prod
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later' } },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const bookingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: process.env.NODE_ENV === 'production' ? 60 : 200, // 60 in prod, 200 in dev
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many booking requests, please slow down' } },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Use routes with rate limiting
  app.use('/auth', authLimiter, authRoutes.getRouter());
  app.use('/auth', authLimiter, invitationRoutes);
  app.use('/auth', authLimiter, registrationLinkRoutes);
  app.use('/campaign', campaignRoutes);
  app.use('/booking', bookingLimiter, bookingRoutes);
  app.use('/audit', createAuditRoutes(db));

  // Health check endpoint
  app.get('/health', (req: Request, res: Response<HealthResponse>) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  // Server time endpoint for client synchronization
  app.get('/server-time', (req: Request, res: Response) => {
    const now = Date.now();
    res.json({
      timestamp: new Date(now).toISOString(),
      unixMs: now
    });
  });


  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
