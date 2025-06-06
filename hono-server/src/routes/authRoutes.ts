import { Hono } from 'hono';
import { sign } from 'hono/jwt'; // Correct import for sign
import { HTTPException } from 'hono/http-exception'; // For throwing HTTP errors

const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const { username, password } = await c.req.json();

  // IMPORTANT: Replace with actual user validation against DB later
  if (username === 'testuser' && password === 'password') {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET not configured for signing token.');
      throw new HTTPException(500, { message: 'Internal server error: JWT secret not configured.' });
    }

    const payload = {
      sub: username, // subject (user identifier)
      role: 'user', // example role
      iat: Math.floor(Date.now() / 1000), // issued at
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // expires in 24 hours (adjust as needed)
    };

    try {
      const token = await sign(payload, secret);
      return c.json({ token });
    } catch (e: any) {
      console.error('Error signing token:', e);
      throw new HTTPException(500, { message: 'Internal server error: Could not sign token.', cause: e });
    }
  }
  throw new HTTPException(401, { message: 'Invalid credentials' });
});

export default authRoutes;
