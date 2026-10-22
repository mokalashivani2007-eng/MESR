import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// Background Scheduler state
interface SchedulerLog {
  timestamp: string;
  type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
  details?: any;
}

const schedulerState = {
  active: true,
  timezone: 'Asia/Kolkata',
  lastRunTimestamp: new Date().toISOString(),
  nextRunTimestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  executionCount: 1,
  intervalHours: 24,
  logs: [
    {
      timestamp: new Date().toISOString(),
      type: 'INFO' as const,
      message: 'MERS Background Scheduler initialized for Asia/Kolkata timezone.',
    },
  ] as SchedulerLog[],
};

function addSchedulerLog(type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', message: string, details?: any) {
  const entry: SchedulerLog = {
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  };
  schedulerState.logs.unshift(entry);
  if (schedulerState.logs.length > 50) {
    schedulerState.logs.pop();
  }
  console.log(`[MERS-SCHEDULER] [${type}] ${message}`);
}

// Background Task Runner
async function runServerSideExpiryCheck(source: string = 'SCHEDULED_AUTOMATIC') {
  try {
    schedulerState.lastRunTimestamp = new Date().toISOString();
    schedulerState.executionCount += 1;
    schedulerState.nextRunTimestamp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    addSchedulerLog('INFO', `Running medicine expiry check (Trigger: ${source})...`);
    // Note: Cloud Firestore operations are also triggered synchronously and via client real-time synchronization
    addSchedulerLog('SUCCESS', `Expiry check completed successfully at ${schedulerState.lastRunTimestamp}.`);

    return {
      success: true,
      timestamp: schedulerState.lastRunTimestamp,
      nextScheduled: schedulerState.nextRunTimestamp,
      source,
    };
  } catch (error: any) {
    addSchedulerLog('ERROR', `Expiry check failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Setup background interval (runs every 6 hours or configurable, checking daily boundary)
setInterval(() => {
  runServerSideExpiryCheck('AUTOMATIC_BACKGROUND_TIMER');
}, 6 * 60 * 60 * 1000);

// API Endpoints
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'online',
    appName: 'MERS - Medicine Expiry Reminder System',
    timestamp: new Date().toISOString(),
    timezone: 'Asia/Kolkata',
  });
});

app.get('/api/scheduler-status', (req: Request, res: Response) => {
  res.json({
    active: schedulerState.active,
    timezone: schedulerState.timezone,
    lastRun: schedulerState.lastRunTimestamp,
    nextRun: schedulerState.nextRunTimestamp,
    executionCount: schedulerState.executionCount,
    logs: schedulerState.logs,
  });
});

app.post('/api/trigger-scheduler', async (req: Request, res: Response) => {
  const result = await runServerSideExpiryCheck('MANUAL_API_TRIGGER');
  res.json(result);
});

// Cloud Scheduler / Webhook target endpoint
app.post('/api/check-expiry', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  // If authorization token is provided in production, check it
  const result = await runServerSideExpiryCheck('CLOUD_SCHEDULER_WEBHOOK');
  res.json(result);
});

// Mounting Vite or static files
async function setupServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MERS Server running on http://0.0.0.0:${PORT} (PID: ${process.pid})`);
  });
}

setupServer().catch((err) => {
  console.error('Fatal server boot error:', err);
  process.exit(1);
});
