// hono-server/src/routes/games/creatureFromTheBlackLagoonNETRoute.ts
import { Hono } from 'hono';
import { CreatureFromTheBlackLagoonNETController } from '../../controllers/games/creatureFromTheBlackLagoonNETController';
// Note: authMiddleware will be applied by the main app router for all routes under /api/games/*
// So, we don't need to apply it here again.

const gameRoute = new Hono();

// The PHP server typically uses a single endpoint with an 'action' query parameter.
// This route simulates that structure.
// Example GET /api/games/CreatureFromTheBlackLagoonNET/request?action=init&sessid=...
gameRoute.get('/request', async (c) => {
    const action = c.req.query('action');

    // Log the received action and all query parameters for debugging
    // console.log(`[CreatureFromTheBlackLagoonNETRoute] Received action: ${action}`, c.req.query());

    switch (action) {
        case 'init':
            return CreatureFromTheBlackLagoonNETController.handleInit(c);
        case 'spin':
            return CreatureFromTheBlackLagoonNETController.handleSpin(c);
        case 'freespin':
            return CreatureFromTheBlackLagoonNETController.handleFreeSpin(c);
        case 'respin': // Corresponds to 'respin' action in PHP's SlotHandler
            return CreatureFromTheBlackLagoonNETController.handleRespin(c);
        case 'paytable':
            return CreatureFromTheBlackLagoonNETController.handlePaytable(c);
        case 'reloadbalance': // PHP 'reloadbalance' often maps to a re-initialization or balance check
            return CreatureFromTheBlackLagoonNETController.handleReloadBalance(c);
        case 'initfreespin': // PHP 'initfreespin' action
            return CreatureFromTheBlackLagoonNETController.handleInitFreeSpin(c);
        default:
            console.error(`[CreatureFromTheBlackLagoonNETRoute] Unknown action: ${action}`);
            return c.json({
                error: 'Unknown action for CreatureFromTheBlackLagoonNET',
                receivedAction: action
            }, 400);
    }
});

// Additional specific routes could be added here if desired for a more RESTful approach,
// but the above /request?action=... matches the typical existing game client communication.

export default gameRoute;
