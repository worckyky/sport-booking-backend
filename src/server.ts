import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger.config';
import { AuthRoutes } from './authentication/routes/auth.routes';
import yclientsRoutes from './yclients/routes/yclients.routes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Types
interface DatabaseQueryRequest {
  table: string;
  select?: string;
  filters?: Record<string, any>;
}

interface HealthResponse {
  status: string;
  timestamp: string;
}

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

// Клиент с anon key для обычных операций
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

// Клиент с service role key для проверки токенов и admin операций
const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

// Initialize routes
const authRoutes = new AuthRoutes(supabase, supabaseAdmin);

// Swagger UI
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Sport Booking API Docs'
}));

// Use routes
app.use('/auth', authRoutes.getRouter());
app.use('/yclients', yclientsRoutes);

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

    let query = supabase.from(table).select(select);

    // Apply filters
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Generic proxy for any Supabase request
app.all('/supabase/*', async (req: Request, res: Response) => {
  try {
    const supabasePath = req.path.replace('/supabase', '');
    const method = req.method.toLowerCase();

    const response = await fetch(`${supabaseUrl}/rest/v1${supabasePath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
        ...req.headers
      },
      body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
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
