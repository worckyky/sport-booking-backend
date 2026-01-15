import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger.config';
import { AuthRoutes } from './authentication/routes/auth.routes';
import createCampaignRoutes from './campaign/routes/campaign.routes';
import { getJwtSecret } from './config/auth';
import { getDbPool } from './config/db';
import { runMigrations } from './scripts/migrations';
import { assertSafeIdentifier, parseSelect, quoteIdentifier } from './utils/sql';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Types
interface DatabaseQueryRequest {
  table: string;
  select?: string;
  filters?: Record<string, unknown>;
}

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
  const campaignRoutes = createCampaignRoutes(db);

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve);
  app.get('/api-docs', swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Sport Booking API Docs'
  }));

  // Use routes
  app.use('/auth', authRoutes.getRouter());
  app.use('/campaign', campaignRoutes);

  // Health check endpoint
  app.get('/health', (req: Request, res: Response<HealthResponse>) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  // Database query endpoint
  app.post('/db/query', async (req: Request<{}, any, DatabaseQueryRequest>, res: Response) => {
    try {
      const { table, select = '*', filters = {} } = req.body;

      if (!table) {
        return res.status(400).json({ error: 'Table name is required' });
      }

      assertSafeIdentifier(table, 'table');
      const columns = parseSelect(select);
      const safeCols =
        columns.length === 1 && columns[0] === '*'
          ? '*'
          : columns
              .map((c) => {
                assertSafeIdentifier(c, 'select column');
                return quoteIdentifier(c);
              })
              .join(', ');

      const whereParts: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, value] of Object.entries(filters)) {
        assertSafeIdentifier(key, 'filter column');
        whereParts.push(`${quoteIdentifier(key)} = $${i}`);
        values.push(value);
        i += 1;
      }

      const sql =
        whereParts.length === 0
          ? `select ${safeCols} from ${quoteIdentifier(table)}`
          : `select ${safeCols} from ${quoteIdentifier(table)} where ${whereParts.join(' and ')}`;

      const result = await db.query(sql, values);
      res.json(result.rows);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
