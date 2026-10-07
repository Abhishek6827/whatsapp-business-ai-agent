import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config.js';

const logger = pino({ level: env.NODE_ENV === 'development' ? 'debug' : 'info' });
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({
  verify: (request, _response, buffer) => {
    (request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  }
}));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'whatsapp-business-ai-agent' });
});

app.get('/webhooks/whatsapp', (request, response) => {
  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN && typeof challenge === 'string') {
    response.status(200).send(challenge);
    return;
  }

  response.sendStatus(403);
});

function validSignature(request: express.Request): boolean {
  if (!env.WHATSAPP_APP_SECRET) return env.NODE_ENV !== 'production';
  const signature = request.header('x-hub-signature-256');
  const rawBody = (request as express.Request & { rawBody?: Buffer }).rawBody;
  if (!signature || !rawBody) return false;

  const expected = `sha256=${createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

app.post('/webhooks/whatsapp', (request, response) => {
  if (!validSignature(request)) {
    response.sendStatus(401);
    return;
  }

  logger.info({ body: request.body }, 'WhatsApp webhook received');
  response.sendStatus(200);
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, 'Unhandled server error');
  response.status(500).json({ error: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Server started');
  });
}

export { app };
