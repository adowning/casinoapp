import { Hono } from 'hono';
import { serve } from '@hono/node-server'; // Using node-server adapter, Bun can run this.
import dotenv from 'dotenv';

// Load .env variables
dotenv.config();

import { authMiddleware } from './middleware/authMiddleware';
import authRoutes from './routes/authRoutes';
import narcosNetApp from './routes/narcosNetRoute'; // Preserve existing game route

const app = new Hono();

// Root path (unprotected)
app.get('/', (c) => {
  return c.text('Hello Hono Server! Welcome to the API.');
});

// Register auth routes (e.g., /auth/login) - unprotected
app.route('/auth', authRoutes);

// Public route - unprotected
app.get('/public', (c) => c.text('This is a public route. Anyone can access this.'));

// Protected route - uses authMiddleware
app.get('/protected', authMiddleware, (c) => {
  const user = c.get('user'); // User payload set by authMiddleware
  return c.json({
    message: 'This is a protected route. You need a valid token to access this.',
    user: user,
  });
});

// Mount the existing NarcosNET game route
// This could also be protected if needed by adding authMiddleware as an argument
// For now, assuming it manages its own session or is public/needs different auth
app.route('/games/NarcosNET', narcosNetApp);

// Server setup for Bun
const port = parseInt(process.env.PORT || '3000');
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port: port,
});

// Export the app for potential other uses (e.g., testing, serverless)
export default app;
