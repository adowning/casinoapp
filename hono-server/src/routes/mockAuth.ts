import { createMiddleware } from 'hono/factory';

export const mockAuth = createMiddleware(async (c, next) => {
  // In a real app, you would verify a token (e.g., JWT from a header)
  // and then set the userId based on the decoded token.
  // For this mock setup, we'll use a static userId.
  c.set('userId', 123); // Mock user ID
  c.set('playerIp', c.req.header('x-forwarded-for') || c.req.header('remote-addr') || '127.0.0.1'); // Try to get real IP or fallback
  await next();
});
