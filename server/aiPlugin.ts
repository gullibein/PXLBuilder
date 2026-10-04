/**
 * Dev/preview server endpoint for AI requests: POST /api/ai.
 *
 * Runs in Node, so the Anthropic credentials (ANTHROPIC_API_KEY in the
 * environment or .env.local, or an `ant auth login` profile) never reach the
 * browser. A production deployment can host the same handler as a backend.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { handleAIRequest } from './anthropicProvider';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function aiPlugin(env: Record<string, string>): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== '/api/ai') return next();
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    try {
      const body = JSON.parse(await readBody(req));
      const result = await handleAIRequest(body, env.ANTHROPIC_API_KEY);
      send(res, result.status, result.body);
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  };
  return {
    name: 'pxlbuilder-ai',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
