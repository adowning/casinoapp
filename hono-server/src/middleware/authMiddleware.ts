import { Context, Next } from 'hono';
import { jwt } from 'hono/jwt';

export const authMiddleware = async (c: Context, next: Next) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET not configured');
    // In a real app, you might want to prevent startup if the secret is missing.
    return c.json({ error: 'Internal server error', details: 'JWT secret not configured.' }, 500);
  }

  // This is the middleware function from hono/jwt
  const jwtMiddlewareInstance = jwt({
    secret: secret,
  });

  // Execute the hono/jwt middleware.
  // It will:
  // - Return a Response object (e.g., 401) if authentication fails.
  // - Call the 'next' function (second argument) if authentication succeeds.
  return jwtMiddlewareInstance(c, async () => {
    // This block is executed if the JWT is valid and hono/jwt's internal logic calls this 'next'.
    const payload = c.get('jwtPayload'); // hono/jwt places the payload here
    if (payload) {
      c.set('user', payload); // Set the user payload for subsequent handlers
    }
    await next(); // Proceed to the *actual* route handler or next middleware in chain
  });
  // Note: If jwtMiddlewareInstance directly returns a Response (on auth failure),
  // that response is what's returned from authMiddleware.
  // If auth succeeds, it calls the async () => { ... } function, which then calls await next().
};
