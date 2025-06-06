import { Hono } from 'hono';
import { serve } from '@hono/node-server'; // Using node-server adapter, Bun can run this.
import dotenv from 'dotenv';

// Load .env variables
dotenv.config();

import { authMiddleware } from './middleware/authMiddleware';
import authRoutes from './routes/authRoutes';
import narcosNetApp from './routes/narcosNetRoute'; // Existing game route
import creatureFromTheBlackLagoonNETRoute from './routes/games/creatureFromTheBlackLagoonNETRoute';
import africanKingNGSocketRoute from './routes/games/africanKingNGSocketRoute'; // New WebSocket route

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
app.route('/games/NarcosNET', narcosNetApp); // This remains as is for now, outside /api

// --- New /api/games router with authentication ---
const gamesApi = new Hono();

// Apply authMiddleware to all routes under /api/games/*
gamesApi.use('*', authMiddleware);

// Mount specific game routes under /api/games
gamesApi.route('/CreatureFromTheBlackLagoonNET', creatureFromTheBlackLagoonNETRoute);
// Example for another game:
// import africanKingNGRoute from './routes/games/africanKingNGRoute';
// gamesApi.route('/AfricanKingNG', africanKingNGRoute);

// Mount the games API sub-router to the main application
app.route('/api/games', gamesApi);
// --- End of /api/games router ---


// --- WebSocket Communications Router ---
// All WebSocket upgrade requests will be authenticated by authMiddleware
const websocketApi = new Hono();
websocketApi.use('*', authMiddleware); // Protect all WebSocket upgrade GET requests

// Mount WebSocket route for AfricanKingNG
// Path will be /ws/AfricanKingNG
websocketApi.route('/AfricanKingNG', africanKingNGSocketRoute);

// Mount the WebSocket API sub-router to the main application
app.route('/ws', websocketApi);
// --- End of WebSocket Communications Router ---


// Server setup for Bun
const port = parseInt(process.env.PORT || '3000');
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port: port,
});

// Export the app for potential other uses (e.g., testing, serverless)
export default app;
