// hono-server/src/routes/games/africanKingNGSocketRoute.ts
import { Hono } from 'hono';
// Note: BungieMembershipType was an accidental import in the plan, removed.
import { User } from '../../generated/prisma'; // Correct import for User type

// Services (will be properly instantiated and used)
import { UserService } from '../../services/UserService';
import { GameConfigService, FullGameConfig } from '../../services/GameConfigService';
import { UserGameStateService } from '../../services/UserGameStateService';
// import { BankService } from '../../services/BankService';
import { LogService, GameSpinLogData } from '../../services/LogService';
import { User } from '@prisma/client'; // Explicit User type

const GAME_NAME = 'AfricanKingNG';

// Paylines for AfricanKingNG (20 lines)
// This should ideally come from gameConfig.settings.paylines_definition or similar.
const PAYLINES_AFRICANKING_RAW: number[][] = [ // Renamed to RAW to avoid confusion if transformation is needed
    [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2], // 1-5
    [0,0,1,2,2], [2,2,1,0,0], [1,0,0,0,1], [1,2,2,2,1], [1,0,1,2,1], // 6-10
    [1,2,1,0,1], [0,1,1,1,0], [2,1,1,1,2], [1,1,0,1,1], [1,1,2,1,1], // 11-15
    [0,1,2,1,2], [2,1,0,1,0], [1,0,2,0,1], [1,2,0,2,1], [0,2,2,2,0]  // 16-20
];

const WILD_SYMBOL_AK = 'SYM_0'; // Lion
const SCATTER_SYMBOL_AK = 'SYM_9'; // Tree/Landscape Scatter

// Helper function to convert all numeric leaf values in an object to strings
function convertNumbersToStringsRecursive(obj: any) {
    for (const key in obj) {
        if (typeof obj[key] === 'number') {
            obj[key] = obj[key].toString();
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            convertNumbersToStringsRecursive(obj[key]);
        }
    }
}


// --- Shared Spin Logic ---
async function _performAfricanKingSpin(
    userId: number,
    user: User,
    gameConfig: FullGameConfig,
    currentUserGameState: Record<string, any>,
    betCoin: number,
    betMultiplier: number,
    isFreeSpin: boolean
): Promise<{
    generatedReels: { symbols: string[][], positions: number[] }; // Symbols are string IDs
    totalWinCoins: number;
    lineWinsArray: any[];
    scatterCount: number;
    nextState: string;
    userGameStateChanges: Record<string, any>;
    bonusSymbol: string | null;
    expansionDidOccur: boolean;
    expandedSymbolId: string | null;
    expandedWinCoins: number;
}> {
    const lines = PAYLINES_AFRICANKING_RAW.length;
    const betPerLineCoins = betMultiplier;

    const userGameStateChanges: Record<string, any> = {};

    // Reel Generation
    const generatedReels: { symbols: string[][], positions: number[] } = { symbols: [], positions: [] };
    for (let i = 0; i < 5; i++) { // 5 reels
        const reelStripKey = isFreeSpin && gameConfig.reel_strips[`reelStripBonus${i + 1}`]
            ? `reelStripBonus${i + 1}`
            : `reelStrip${i + 1}`;
        const strip = gameConfig.reel_strips[reelStripKey] || [];

        if (strip.length < 3) {
            console.error(`[${GAME_NAME}] Reel strip ${reelStripKey} is too short! Length: ${strip.length}`);
            generatedReels.symbols.push(['SYM_1', 'SYM_1', 'SYM_1']); // Fallback
            generatedReels.positions.push(0);
            userGameStateChanges[`${GAME_NAME}Reel${i + 1}Pos`] = 0;
            continue;
        }

        const pos = Math.floor(Math.random() * (strip.length - 2 > 0 ? strip.length - 2 : 1));
        generatedReels.symbols.push([strip[pos], strip[pos + 1], strip[pos + 2]]);
        generatedReels.positions.push(pos);
        userGameStateChanges[`${GAME_NAME}Reel${i + 1}Pos`] = pos;
    }

    // --- Expanding Symbol Logic (AfricanKingNG specific for Free Spins) ---
    const activeBonusSymbol = currentUserGameState[`${GAME_NAME}BonusSymbol`] as string | null;
    let reelsAfterExpansion = JSON.parse(JSON.stringify(generatedReels.symbols)); // Start with initial reels
    let expansionDidOccurThisSpin = false;
    let winFromExpansionCoins = 0;
    let actualExpandingSymbolId: string | null = null;


    // --- Initial Line Win Calculation (Pre-Expansion) ---
    let initialTotalWinCoins = 0;
    const initialLineWinsArray: any[] = [];
     for (let i = 0; i < PAYLINES_AFRICANKING.length; i++) {
        const payline = PAYLINES_AFRICANKING[i];
        const symbolsOnLine: string[] = [];
        const symbolPositionsOnLine: { reel: number, row: number }[] = [];

        for (let reelIdx = 0; reelIdx < payline.length; reelIdx++) {
            symbolsOnLine.push(generatedReels.symbols[reelIdx][payline[reelIdx]]); // Use initial reels for line wins
            symbolPositionsOnLine.push({ reel: reelIdx, row: payline[reelIdx] });
        }

        let firstSymbol = symbolsOnLine[0];
        if (firstSymbol === WILD_SYMBOL_AK) {
            let k = 1;
            while(k < symbolsOnLine.length && symbolsOnLine[k] === WILD_SYMBOL_AK) k++;
            if (k < symbolsOnLine.length) firstSymbol = symbolsOnLine[k];
        }

        let matchCount = 0;
        for (let k = 0; k < symbolsOnLine.length; k++) {
            if (symbolsOnLine[k] === firstSymbol || symbolsOnLine[k] === WILD_SYMBOL_AK) {
                matchCount++;
            } else {
                break;
            }
        }

        const paytableEntry = gameConfig.paytable.find(
            (p) => p.symbol === firstSymbol && p.match_count === matchCount
        );

        if (paytableEntry && paytableEntry.payout_multiplier > 0) {
            const winForLineCoins = paytableEntry.payout_multiplier * betPerLineCoins;
            initialTotalWinCoins += winForLineCoins;
            initialLineWinsArray.push({
                type: "LineWinAmount",
                selectedLine: i,
                amount: winForLineCoins,
                wonSymbols: symbolPositionsOnLine.slice(0, matchCount)
            });
        }
    }

    // --- Expanding Symbol Logic for Free Spins ---
    if (isFreeSpin && activeBonusSymbol) {
        actualExpandingSymbolId = activeBonusSymbol; // Capture the symbol ID
        const reelsContainingBonusSymbol = new Set<number>();
        generatedReels.symbols.forEach((reelSymbols, reelIdx) => {
            if (reelSymbols.includes(activeBonusSymbol)) {
                reelsContainingBonusSymbol.add(reelIdx);
            }
        });

        const minReelsForExpansion = gameConfig.settings?.minReelsForExpansionAK ?? 2;
        if (reelsContainingBonusSymbol.size >= minReelsForExpansion) {
            expansionDidOccurThisSpin = true;

            reelsContainingBonusSymbol.forEach(reelIdx => {
                const newReel = [activeBonusSymbol, activeBonusSymbol, activeBonusSymbol];
                reelsAfterExpansion[reelIdx] = newReel;
            });

            const paytableEntryForExpansion = gameConfig.paytable.find(
                p => p.symbol === activeBonusSymbol && p.match_count === reelsContainingBonusSymbol.size
            );

            if (paytableEntryForExpansion && paytableEntryForExpansion.payout_multiplier > 0) {
                // Expanding symbol win: PaytableMultiplier * BetPerLine * NumberOfActiveLines
                winFromExpansionCoins = (Number(paytableEntryForExpansion.payout_multiplier) || 0) * betPerLineCoins * lines;
            }
        }

        if (expansionDidOccurThisSpin) {
            generatedReels.symbols = reelsAfterExpansion; // Reels for response now show expanded state
        }
    }

    const totalWinCoins = initialTotalWinCoins + winFromExpansionCoins;
    const finalLineWinsArray = [...initialLineWinsArray];
    // Note: If expanded wins need to be detailed separately in lineWinsArray for client,
    // that logic would go here. For now, it's part of totalWinCoins.


    // --- Scatter Handling & State Transitions ---
    let scatterCount = 0;
    for (let r = 0; r < 5; r++) {
        for (let L = 0; L < 3; L++) {
            // Use original reels (pre-expansion) for scatter count, as expansion typically doesn't create new scatters
            const originalReelsForScatterCheck = expansionDidOccur ? JSON.parse(JSON.stringify(generatedReels.symbols)) : generatedReels.symbols; // Need pre-expansion if checking original
            // This is tricky. Let's assume scatter count is from initial spin reels, not after expansion.
            // Or, if expanding symbol IS scatter, then it's different. Assume expanding symbol is not scatter.
            if (generatedReels.symbols[r][L] === SCATTER_SYMBOL_AK && bonusSymbolForExpansion !== SCATTER_SYMBOL_AK) { // Check on initial generated (or post-sticky pre-expansion)
                scatterCount++;
            }
        }
    }

    let nextState = "Ready";
    if (!isFreeSpin && scatterCount >= 3) {
        nextState = "PickBonus";
        userGameStateChanges[`${GAME_NAME}BonusState`] = 2;
        userGameStateChanges[`${GAME_NAME}Picks`] = gameConfig.settings?.pickBonusPicksCount ?? 3;
        userGameStateChanges[`${GAME_NAME}SelectedItems`] = [];
        userGameStateChanges[`${GAME_NAME}Items`] = [];

        const scatterPayEntry = gameConfig.paytable.find(p => p.symbol === SCATTER_SYMBOL_AK && p.match_count === scatterCount);
        if (scatterPayEntry && scatterPayEntry.payout_multiplier > 0) {
            // Scatter wins are often total_bet multipliers.
            // PHP: $Paytable['SYM_9'][$scattersCount] * $betLine * $lines;
            // So, payout_multiplier * betPerLineCoins * lines.
            const scatterWin = (Number(scatterPayEntry.payout_multiplier) || 0) * betPerLineCoins * lines;
            // This scatterWin should be part of totalWinCoins if it's separate from line wins or expansion wins.
            // Assuming it's already included if scatters form lines or handled via a specific scatter paytable entry.
            // If it's a separate addition: totalWinCoins += scatterWin;
        }
    }

    if (isFreeSpin) {
        userGameStateChanges[`${GAME_NAME}CurrentFreeGame`] = (currentUserGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0) + 1;
        const totalFreespins = currentUserGameState[`${GAME_NAME}FreeSpinsTotal`] ?? 0;
        if (userGameStateChanges[`${GAME_NAME}CurrentFreeGame`] >= totalFreespins) {
            nextState = "Ready";
            userGameStateChanges[`${GAME_NAME}FreeSpinsActive`] = false;
            userGameStateChanges[`${GAME_NAME}BonusSymbol`] = null;
        } else {
            nextState = "FreeSpins";
        }
        userGameStateChanges[`${GAME_NAME}TotalFreeSpinWin`] = (currentUserGameState[`${GAME_NAME}TotalFreeSpinWin`] ?? 0) + totalWinCoins;
    }

    return {
        generatedReels, // These are now post-expansion if expansion occurred
        totalWinCoins,
        lineWinsArray: finalLineWinsArray,
        scatterCount,
        nextState,
        userGameStateChanges,
        bonusSymbol: activeBonusSymbol, // This is the symbol chosen to be expanding
        expansionDidOccur: expansionDidOccurThisSpin,
        expandedSymbolId: expansionDidOccurThisSpin ? actualExpandingSymbolId : null, // Same as activeBonusSymbol if expansion happened
        expandedWinCoins: winFromExpansionCoins,
    };
}


const app = new Hono();

app.get('/', async (c) => { // WebSocket upgrade typically happens on a GET request
  const jwtPayload = c.get('user'); // Auth middleware should have run before this route

  if (!jwtPayload || !jwtPayload.sub) {
    console.error(`[${GAME_NAME}-Socket] Unauthorized: No JWT payload or sub.`);
    return c.text('Unauthorized for WebSocket', 401);
  }
  const userId = parseInt(jwtPayload.sub, 10);
  if (isNaN(userId)) {
    console.error(`[${GAME_NAME}-Socket] Invalid user ID in JWT: ${jwtPayload.sub}`);
    return c.text('Invalid user ID for WebSocket', 400);
  }

  // Bun's native WebSocket upgrade
  // Ensure server is configured for websocket in Bun.serve: websocket: { open, message, close, error }
  // Hono's `upgradeWebSocket` helper can also be used if preferred, but Bun.upgradeWebSocket is direct.
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade request', 400);
  }

  const { response, socket } = Bun.upgradeWebSocket<{userId: number}>(c.req.raw); // Pass type for socket.data

  socket.data = { userId }; // Store userId in socket data

  socket.onopen = async () => {
    console.log(`[${GAME_NAME}-Socket] Connection opened for user ${userId}`);
    // Optionally send an initial message after auth/setup if protocol requires
    // e.g., socket.send(JSON.stringify({ action: "Welcome", message: "Connected to AfricanKingNG" }));
  };

  socket.onmessage = async (event) => {
    const messageData = event.data.toString();
    console.log(`[${GAME_NAME}-Socket] Received message from user ${socket.data.userId}:`, messageData);

    let request;
    try {
      request = JSON.parse(messageData);
    } catch (e) {
      console.error(`[${GAME_NAME}-Socket] Invalid JSON message from user ${socket.data.userId}:`, e);
      socket.send(JSON.stringify({ action: "Error", result: false, data: { message: "Invalid JSON format" }}));
      return;
    }

    // NG (NetGame) protocol often uses 'cmd' inside a 'gameData' object, or 'action' at top level.
    const cmd = request.gameData?.cmd || request.cmd || request.action;
    const data = request.gameData?.data || request.data || {};

    try {
        const user = await UserService.getUserById(socket.data.userId);
        const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);

        if (!user || !gameConfig) {
            const errorMsg = `User or game config not found for user ${socket.data.userId}, game ${GAME_NAME}`;
            console.error(`[${GAME_NAME}-Socket] ${errorMsg}`);
            socket.send(JSON.stringify({ action: cmd ? cmd + 'Response' : 'ErrorResponse', result: false, data: { message: errorMsg }}));
            return;
        }

        // For commands that don't need userGameState immediately, it can be fetched within the case.
        let userGameState = await UserGameStateService.getUserGameState(socket.data.userId, gameConfig.id);

        switch (cmd) {
          case 'APIVersionRequest':
            socket.send(JSON.stringify({
              action: 'APIVersionResponse',
              result: true,
              sesId: false, // NG often uses boolean false for sesId in some contexts
              data: { router: 'v3.12', transportConfig: { reconnectTimeout: 500000000000 } } // Example values
            }));
            break;

          case 'AuthRequest': // NG games have their own AuthRequest after WebSocket connection
            // This confirms session/token, returns initial game params. JWT already authorized upgrade.
            // Initialize some game states if needed (mirroring PHP logic)
            // Example: await UserGameStateService.updateUserGameState(socket.data.userId, gameConfig.id, 'LastBet', null);

            const denominations = (gameConfig.settings?.Denominations || gameConfig.settings?.denomination_all || [0.01, 0.02, 0.05]);
            const defaultDenom = denominations[0] || 0.01;
            const bets = (gameConfig.settings?.bet_levels || gameConfig.settings?.betlevel_all || [1,2,3,4,5,10]);
            const defaultBet = bets[0] || 1;

            socket.send(JSON.stringify({
                action: "AuthResponse",
                result: true,
                sesId: `sess_${socket.data.userId}_${Date.now()}`, // Example session ID
                data: {
                    snivy: "hono-server v0.1 (API vX.Y)", // Server version info
                    supportedFeatures: ["Jackpots"], // Example
                    sessionId: `sess_${socket.data.userId}_${Date.now()}`,
                    defaultLines: PAYLINES_AFRICANKING_RAW.map((_,i)=>i.toString()), // Array of line indices as strings
                    bets: bets.map(String), // Array of bet multipliers as strings
                    betMultiplier: (gameConfig.settings?.betMultiplier || "1.0").toString(),
                    defaultBet: String(defaultBet),
                    defaultCoinValue: String(defaultDenom),
                    coinValues: denominations.map(String), // Array of coin values as strings
                    gameParameters: {
                        availableLines: PAYLINES_AFRICANKING_RAW.map(line => line.map((row, reel) => `${reel},${row}`)), // e.g., [["0,1","1,1",...],...]
                        payouts: gameConfig.paytable.map(p => ({
                            payout: p.payout_multiplier.toString(),
                            symbols: [p.symbol, p.symbol], // NG format often shows [symbol, symbol] for basic, or more for complex
                            type: p.symbol === SCATTER_SYMBOL_AK ? "scatter" : "basic", // Distinguish scatter payouts
                            count: p.match_count.toString(), // Add match count
                        })),
                        rtp: (gameConfig.settings?.rtpPercentage || "96.00").toString(),
                    },
                    initialSymbols: gameConfig.reel_strips.reelStrip1 ? // Generate a default 5x3 grid
                        [0,1,2].map(rowIndex =>
                            [0,1,2,3,4].map(reelIndex =>
                                gameConfig.reel_strips[`reelStrip${reelIndex + 1}`]?.[rowIndex] || 'SYM_X' // Fallback symbol
                            )
                        ) : [],
                    jackpotsEnabled: "true",
                    gameModes: "[]",
                    balance: { entries: "0.00", totalAmount: (user.balance ?? 0).toFixed(2), currency: user.currency || 'EUR' },
                    userId: socket.data.userId.toString(),
                }
            }));
            break;

          case 'BalanceRequest':
            const balance = user.balance ?? 0;
            socket.send(JSON.stringify({
              action: 'BalanceResponse',
              result: true,
              sesId: `sess_${socket.data.userId}_${Date.now()}`,
              data: { entries: '0.00', totalAmount: balance.toFixed(2), currency: user.currency || 'EUR' }
            }));
            break;

          case 'SpinRequest':
          case 'FreeSpinRequest': {
            const isFreeSpinRequest = cmd === 'FreeSpinRequest';
            let betCoinValue: number;
            let betMultiplierValue: number;
            let sessionIdentifier = `sess_${socket.data.userId}_${Date.now()}`; // Common session ID for response

            if (isFreeSpinRequest) {
                if (!userGameState[`${GAME_NAME}FreeSpinsActive`] || (userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0) >= (userGameState[`${GAME_NAME}FreeSpinsTotal`] ?? 0)) {
                    socket.send(JSON.stringify({ action: 'FreeSpinResponse', result: false, sesId: sessionIdentifier, data: { message: "No active free spins or no free spins left." } }));
                    return;
                }
                betCoinValue = userGameState[`${GAME_NAME}BetCoinValueForFS`] ?? gameConfig.settings?.defaultCoinValue ?? 0.01;
                betMultiplierValue = userGameState[`${GAME_NAME}BetMultiplierForFS`] ?? gameConfig.settings?.defaultBet ?? 1;
            } else { // SpinRequest
                betCoinValue = parseFloat(data.coin);
                betMultiplierValue = parseInt(data.bet, 10);

                if (isNaN(betCoinValue) || isNaN(betMultiplierValue) || betCoinValue <= 0 || betMultiplierValue <= 0) {
                    socket.send(JSON.stringify({ action: 'SpinResponse', result: false, sesId: sessionIdentifier, data: { message: "Invalid bet parameters." } }));
                    return;
                }
                // TODO: Validate betCoinValue and betMultiplierValue against gameConfig.settings.coinValues and gameConfig.settings.bets

                const totalBetAmountCurrency = betCoinValue * betMultiplierValue * PAYLINES_AFRICANKING.length;
                if ((user.balance ?? 0) < totalBetAmountCurrency) {
                    socket.send(JSON.stringify({ action: 'SpinResponse', result: false, sesId: sessionIdentifier, data: { message: "Insufficient balance." } }));
                    return;
                }

                // Deduct bet for SpinRequest
                const balanceUpdateArgs = { userId: socket.data.userId, amount: -totalBetAmountCurrency, transactionType: 'spin_bet', systemName: GAME_NAME };
                const updatedUserAfterBet = await UserService.updateUserBalance(balanceUpdateArgs);
                if (!updatedUserAfterBet) {
                    socket.send(JSON.stringify({ action: 'SpinResponse', result: false, sesId: sessionIdentifier, data: { message: "Failed to update balance for bet." } }));
                    return;
                }
                user = updatedUserAfterBet; // Refresh user object with new balance

                // TODO: Add to game bank via BankService.updateBank. Requires shop_id and bank type.
                // const shopId = user.shop_id;
                // const gameBankType = gameConfig.gamebank || 'slots';
                // if(shopId && totalBetAmountCurrency > 0) await BankService.updateBank(shopId, gameBankType, totalBetAmountCurrency * 0.9); // Example: 90% to bank

                // Save bet config for potential free spins triggered by this spin
                userGameState[`${GAME_NAME}BetCoinValueForFS`] = betCoinValue;
                userGameState[`${GAME_NAME}BetMultiplierForFS`] = betMultiplierValue;
            }

            const spinResult = await _performAfricanKingSpin(socket.data.userId, user, gameConfig, userGameState, betCoinValue, betMultiplierValue, isFreeSpinRequest);

            let finalUserBalance = user.balance ?? 0;
            // Update user balance with winnings
            if (spinResult.totalWinCoins > 0) {
                const totalWinCurrency = spinResult.totalWinCoins * betCoinValue;
                const winUpdateArgs = { userId: socket.data.userId, amount: totalWinCurrency, transactionType: isFreeSpinRequest ? 'freespin_win' : 'spin_win', systemName: GAME_NAME };
                const finalUserAfterWin = await UserService.updateUserBalance(winUpdateArgs);
                if (finalUserAfterWin) {
                    user = finalUserAfterWin; // Refresh user object
                    finalUserBalance = finalUserAfterWin.balance ?? 0;
                } else {
                     console.error(`[${GAME_NAME}-Socket] Failed to update balance after win for user ${socket.data.userId}`);
                     // Continue with original balance for response, but this is an issue.
                }
            }

            // Persist all game state changes made by _performAfricanKingSpin
            for (const key in spinResult.userGameStateChanges) {
                await UserGameStateService.updateUserGameState(socket.data.userId, gameConfig.id, key, spinResult.userGameStateChanges[key]);
            }
             // Refresh userGameState after updates for response consistency
            userGameState = await UserGameStateService.getUserGameState(socket.data.userId, gameConfig.id);


            const responseAction = isFreeSpinRequest ? 'FreeSpinResponse' : 'SpinResponse';
            const responseData = {
                spinResult: {
                    type: isFreeSpinRequest ? "FreeSpinResult" : "SpinResult",
                    rows: spinResult.generatedReels.symbols // NG expects array of arrays of symbol strings
                },
                slotWin: spinResult.totalWinCoins > 0 ? {
                    totalWin: spinResult.totalWinCoins.toString(), // String
                    lineWinAmounts: spinResult.lineWinsArray.map(lw => ({
                        type: "LineWinAmount",
                        selectedLine: lw.selectedLine.toString(),
                        amount: lw.amount.toString(),
                        wonSymbols: lw.wonSymbols.map((pos: {reel:number, row:number}) => [pos.reel.toString(), pos.row.toString()])
                    })),
                    // If expandedWinCoins is part of totalWin and not detailed separately in lineWinsArray for NG:
                    ...(spinResult.expansionDidOccur && spinResult.expandedWinCoins > 0 && !isFreeSpinRequest ? { // Add expansion win detail if needed
                        expandedWin: { // Example structure, needs PHP verification
                            symbol: spinResult.expandedSymbolId,
                            amount: spinResult.expandedWinCoins.toString()
                        }
                    } : {})
                } : null,
                state: spinResult.nextState,
                balance: { entries: "0.00", totalAmount: finalUserBalance.toFixed(2), currency: user.currency || 'EUR' }, // Balance should be string
                nextState: spinResult.nextState,
                ...(isFreeSpinRequest || spinResult.nextState === "FreeSpins" || userGameState[`${GAME_NAME}FreeSpinsActive`] ? {
                    freeSpinRemain: (Math.max(0, (userGameState[`${GAME_NAME}FreeSpinsTotal`] ?? 0) - (userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0))).toString(),
                    freeSpinsTotal: (userGameState[`${GAME_NAME}FreeSpinsTotal`] ?? 0).toString(),
                    totalBonusWin: (userGameState[`${GAME_NAME}TotalFreeSpinWin`] ?? 0).toString(),
                    expandingSymbols: (isFreeSpinRequest && spinResult.expansionDidOccur && spinResult.expandedSymbolId) ? [spinResult.expandedSymbolId] : [],
                    // expandedWinAmountCoins is now part of totalWinCoins in _performAfricanKingSpin
                } : {}),
                ...(spinResult.nextState === "PickBonus" ? {
                    bonusType: "PickBonus",
                    picksLeft: (userGameState[`${GAME_NAME}Picks`] ?? 0).toString(),
                    // PHP response for SpinRequest triggering PickBonus might include initial items for pick bonus here
                    // e.g., items: Array(25).fill(null).map((_,idx)=>({index:idx.toString(), value:"0", picked:"false"}))
                } : {}),
            };

            convertNumbersToStringsRecursive(responseData.balance); // Ensure balance fields are strings
            if (responseData.slotWin) convertNumbersToStringsRecursive(responseData.slotWin);

            socket.send(JSON.stringify({ action: responseAction, result: true, sesId: sessionIdentifier, data: responseData }));

            // Log the spin
            const spinLogData: GameSpinLogData = {
                userId: socket.data.userId,
                gameId: gameConfig.id,
                gameName: GAME_NAME,
                shopId: user.shop_id ?? undefined,
                responseData: JSON.stringify(responseData),
                betAmount: isFreeSpinRequest ? 0 : betCoinValue * betMultiplierValue * PAYLINES_AFRICANKING.length,
                winAmount: spinResult.totalWinCoins * betCoinValue,
                ipAddress: c.req.header('x-forwarded-for') || c.req.header('remote-addr'),
                userBalanceAfterSpin: finalUserBalance,
                denomination: betCoinValue,
                // TODO: toGameBanks, toSlotJackBanks, betProfit need actual values from casino math
            };
            await LogService.logGameSpin(spinLogData);
            break;
          }

          case 'PickBonusItemRequest': {
            let sessionIdentifier = `sess_${socket.data.userId}_${Date.now()}`;
            try {
              // user and gameConfig should already be loaded from the top of onmessage handler
              if (!user || !gameConfig) { // Should have been caught earlier, but good check
                socket.send(JSON.stringify({ action: 'PickBonusItemResponse', result: false, sesId: sessionIdentifier, data: { message: "User or game config not found." } }));
                return;
              }
              // Refresh userGameState for this specific request context
              userGameState = await UserGameStateService.getUserGameState(socket.data.userId, gameConfig.id);

              if (userGameState[`${GAME_NAME}BonusState`] !== 2 || (userGameState[`${GAME_NAME}Picks`] || 0) <= 0) {
                socket.send(JSON.stringify({ action: 'PickBonusItemResponse', result: false, sesId: sessionIdentifier, data: { message: "Not in PickBonus state or no picks left." } }));
                return;
              }

              const itemIndex = parseInt(data.index, 10); // Client sends item.index
              // Assuming item indices are 0-based from client, or adjust if 1-based. PHP example suggests 0-24.
              // For this example, let's assume client sends 0-24 if there are 25 items.
              // Max items typically 25 for this kind of bonus. This should be configurable.
              const maxBonusItems = gameConfig.settings?.pickBonusMaxItems || 25;
              if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= maxBonusItems) {
                  socket.send(JSON.stringify({ action: 'PickBonusItemResponse', result: false, sesId: sessionIdentifier, data: { message: "Invalid item index." } }));
                  return;
              }

              const selectedItemsSoFar: number[] = userGameState[`${GAME_NAME}SelectedItems`] || [];
              if (selectedItemsSoFar.includes(itemIndex)) {
                  socket.send(JSON.stringify({ action: 'PickBonusItemResponse', result: false, sesId: sessionIdentifier, data: { message: "Item already picked." } }));
                  return;
              }

              // Determine awarded value (free spins for African King NG PickBonus)
              // PHP: $Items = array(1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,3,3,3,3,3); shuffle($Items); $items[$i] = $Items[$i];
              // This means a predefined distribution of 1, 2, or 3 spins.
              // For simplicity here, random 1-3. For accuracy, use a predefined shuffled array from gameConfig.settings.
              const awardedSpins = Math.floor(Math.random() * 3) + 1;

              const userGameStateChanges: Record<string, any> = {};

              userGameStateChanges[`${GAME_NAME}SelectedItems`] = [...selectedItemsSoFar, itemIndex];
              userGameStateChanges[`${GAME_NAME}AccumulatedFreeSpins`] = (userGameState[`${GAME_NAME}AccumulatedFreeSpins`] || 0) + awardedSpins;
              userGameStateChanges[`${GAME_NAME}Picks`] = (userGameState[`${GAME_NAME}Picks`] || 0) - 1;

              // History stores {index, value (spins), picked:true}
              // The value format "1X" (e.g., "12" for 2 spins) is specific to NG client parsing.
              const pickedItemForHistory = { index: itemIndex.toString(), value: "1" + awardedSpins.toString(), picked: "true" };
              userGameStateChanges[`${GAME_NAME}PickedItemsHistory`] = [...(userGameState[`${GAME_NAME}PickedItemsHistory`] || []), pickedItemForHistory];


              const responsePayloadData: any = {};

              if (userGameStateChanges[`${GAME_NAME}Picks`] === 0) { // Last pick
                responsePayloadData.lastPick = true;
                responsePayloadData.state = "FreeSpins"; // Transition to FreeSpins state
                const totalAccumulatedSpins = userGameStateChanges[`${GAME_NAME}AccumulatedFreeSpins`];

                responsePayloadData.params = {
                    freeSpins: totalAccumulatedSpins.toString(),
                    multiplier: "1", // AfricanKingNG typically doesn't use multiplier from pick bonus itself
                    freeSpinRemain: totalAccumulatedSpins.toString(),
                    freeSpinsTotal: totalAccumulatedSpins.toString()
                };

                const allItemsForResponse = [...userGameStateChanges[`${GAME_NAME}PickedItemsHistory`]];
                for (let i = 0; i < maxBonusItems; i++) {
                  if (!userGameStateChanges[`${GAME_NAME}SelectedItems`].includes(i)) {
                    // Generate dummy unpicked value, again using "1X" format
                    allItemsForResponse.push({ index: i.toString(), value: "1" + (Math.floor(Math.random() * 3) + 1).toString(), picked: "false" });
                  }
                }
                responsePayloadData.items = allItemsForResponse;

                // Prepare UserGameState for starting Free Spins
                userGameStateChanges[`${GAME_NAME}FreeSpinsTotal`] = totalAccumulatedSpins;
                userGameStateChanges[`${GAME_NAME}CurrentFreeGame`] = 0; // 0 games played, next will be 1st
                userGameStateChanges[`${GAME_NAME}BonusState`] = 0; // Reset BonusState (0 = none, 2 = PickBonus)
                userGameStateChanges[`${GAME_NAME}FreeSpinsActive`] = true;
                userGameStateChanges[`${GAME_NAME}TotalFreeSpinWin`] = 0; // Reset total win for this FS session
                // Clear PickBonus specific states
                userGameStateChanges[`${GAME_NAME}AccumulatedFreeSpins`] = 0;
                userGameStateChanges[`${GAME_NAME}SelectedItems`] = [];
                userGameStateChanges[`${GAME_NAME}PickedItemsHistory`] = [];
                userGameStateChanges[`${GAME_NAME}Picks`] = 0;

                // Randomly select BonusSymbol for Free Spins (excluding Wild and Scatter)
                const possibleBonusSymbols = (gameConfig.settings?.expandingSymbolsListAK || ['SYM_1', 'SYM_2', 'SYM_3', 'SYM_4', 'SYM_5', 'SYM_6', 'SYM_7', 'SYM_8']);
                userGameStateChanges[`${GAME_NAME}BonusSymbol`] = possibleBonusSymbols[Math.floor(Math.random() * possibleBonusSymbols.length)];

              } else { // Not the last pick
                responsePayloadData.lastPick = false;
                responsePayloadData.state = "PickBonus"; // Remain in PickBonus state
                responsePayloadData.bonusItem = { type: "IndexedItem", index: itemIndex.toString(), value: "1" + awardedSpins.toString(), picked: "false" }; // Current pick, client might show it as unpicked until all revealed
                responsePayloadData.params = { freeSpins: userGameStateChanges[`${GAME_NAME}AccumulatedFreeSpins`].toString() };
                responsePayloadData.picksLeft = userGameStateChanges[`${GAME_NAME}Picks`];
              }

              // Persist all UserGameState changes
              for (const key in userGameStateChanges) {
                  await UserGameStateService.updateUserGameState(socket.data.userId, gameConfig.id, key, userGameStateChanges[key]);
              }

              socket.send(JSON.stringify({
                action: 'PickBonusItemResponse',
                result: true,
                sesId: sessionIdentifier,
                data: responsePayloadData
              }));

              // TODO: LogService.logBonusPick({ userId, gameId, pick: itemIndex, value: awardedSpins, picksLeft, totalFsAccumulated });
            } catch (error: any) {
              console.error(`[${GAME_NAME}-Socket] Error processing PickBonusItemRequest for user ${socket.data.userId}:`, error);
              socket.send(JSON.stringify({ action: 'PickBonusItemResponse', result: false, sesId: sessionIdentifier, data: { message: 'Internal server error', details: error.message }}));
            }
            break;
          }

          default:
            console.warn(`[${GAME_NAME}-Socket] Unknown command received from user ${socket.data.userId}: ${cmd}`);
            socket.send(JSON.stringify({ action: cmd ? cmd + 'Response' : 'UnknownCommandResponse', result: false, data: { message: 'Unknown command' }}));
            socket.send(JSON.stringify({ action: cmd ? cmd + 'Response' : 'UnknownCommandResponse', result: false, data: { message: 'Unknown command' }}));
        }
    } catch (error: any) {
        console.error(`[${GAME_NAME}-Socket] Error processing command '${cmd}' for user ${socket.data.userId}:`, error);
        socket.send(JSON.stringify({ action: cmd ? cmd + 'Response' : 'ErrorResponse', result: false, data: { message: 'Internal server error while processing command.', details: error.message }}));
    }
  };

  socket.onclose = (event) => {
    console.log(`[${GAME_NAME}-Socket] Connection closed for user ${socket.data.userId}. Code: ${event.code}, Reason: ${event.reason}`);
  };

  socket.onerror = (err) => {
    console.error(`[${GAME_NAME}-Socket] WebSocket error for user ${socket.data.userId}:`, err);
  };

  return response; // Crucial for Bun to handle the WebSocket upgrade via Hono
});

// A placeholder for paylines if needed by AuthResponse.
// This should ideally come from gameConfig.settings.paylines_definition or similar.
const PAYLINES_AFRICANKING: number[][] = [ /* ... AfricanKingNG payline definitions ... */ ];


export default app;
