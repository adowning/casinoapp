// hono-server/src/controllers/games/creatureFromTheBlackLagoonNETController.ts
import { Context } from 'hono';
import { UserService, UpdateUserBalanceArgs } from '../../services/UserService';
import { GameConfigService, FullGameConfig } from '../../services/GameConfigService';
import { UserGameStateService } from '../../services/UserGameStateService';
import { BankService } from '../../services/BankService';
import { LogService, GameSpinLogData } from '../../services/LogService';
import { User } from '@prisma/client'; // Import User type

const GAME_NAME = 'CreatureFromTheBlackLagoonNET';

// Paylines for Creature From The Black Lagoon (20 lines)
// Based on common NetEnt 20-line structure. Verify if specific to this game from PHP.
// Each inner array represents [reel0_row, reel1_row, reel2_row, reel3_row, reel4_row] (0-indexed rows)
const PAYLINES: number[][] = [
    [1, 1, 1, 1, 1], // Line 1 (middle row)
    [0, 0, 0, 0, 0], // Line 2 (top row)
    [2, 2, 2, 2, 2], // Line 3 (bottom row)
    [0, 1, 2, 1, 0], // Line 4 (V shape)
    [2, 1, 0, 1, 2], // Line 5 (Inverse V shape)
    [0, 0, 1, 2, 2], // Line 6
    [2, 2, 1, 0, 0], // Line 7
    [1, 0, 0, 0, 1], // Line 8
    [1, 2, 2, 2, 1], // Line 9
    [1, 0, 1, 2, 1], // Line 10
    [1, 2, 1, 0, 1], // Line 11
    [0, 1, 0, 1, 0], // Line 12
    [2, 1, 2, 1, 2], // Line 13
    [0, 1, 1, 1, 0], // Line 14
    [2, 1, 1, 1, 2], // Line 15
    [1, 1, 0, 1, 1], // Line 16
    [1, 1, 2, 1, 1], // Line 17
    [0, 0, 2, 0, 0], // Line 18
    [2, 2, 0, 2, 2], // Line 19
    [0, 2, 0, 2, 0], // Line 20
];

// --- Shared Spin Logic ---
async function _performSpinLogic(
    c: Context,
    userId: number,
    user: User, // Pass the fetched user object
    gameConfig: FullGameConfig,
    userGameState: Record<string, any>,
    betLevel: number,
    denom: number, // Denomination in currency units (e.g., 0.01)
    isFreeSpin: boolean,
    isRespin: boolean // TODO: Implement respin specific logic (sticky wilds)
): Promise<Context | Response> {
    const lines = 20; // Fixed for Creature From The Black Lagoon
    const betAmountCoins = betLevel * lines; // Bet amount in coins for this spin
    const betAmountCurrency = isFreeSpin ? 0 : betAmountCoins * denom;

    // Log entry for this spin
    const spinLogEntry: Partial<GameSpinLogData> = {
        userId,
        gameId: gameConfig.id,
        gameName: GAME_NAME,
        shopId: user.shop_id ?? undefined,
        betAmount: betAmountCurrency,
        winAmount: 0, // Will be updated
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('remote-addr'),
        denomination: denom,
        userBalanceAfterSpin: user.balance ?? 0, // Initial, will be updated
    };

    // 3. Get Spin Settings (Simplified: random outcome for now)
    // TODO: Port PHP GetSpinSettings logic (determines if win, bonus, or none based on RTP etc.)
    // For now, every spin is a "normal" spin, outcome determined by reels.

    // 4. Generate Reel Strips
    const generatedReels: { symbols: string[][], positions: number[] } = { symbols: [], positions: [] };
    const finalReelPositions: Record<string, number> = {};

    for (let i = 0; i < 5; i++) { // 5 reels
        const reelStripKey = isFreeSpin ? `reelStripBonus${i + 1}` : `reelStrip${i + 1}`; // Or more complex logic for free spin strips
        const strip = gameConfig.reel_strips[reelStripKey] || gameConfig.reel_strips[`reelStrip${i + 1}`] || [];

        if (strip.length < 3) {
            console.error(`[${GAME_NAME}] Reel strip ${reelStripKey} is too short! Length: ${strip.length}`);
            // Fallback to a default strip if a specific one is missing or too short
            generatedReels.symbols.push(['SYM_0', 'SYM_0', 'SYM_0']);
            generatedReels.positions.push(0);
            finalReelPositions[`${GAME_NAME}Reel${i+1}Pos`] = 0;
            continue;
        }

        const pos = Math.floor(Math.random() * (strip.length - 2)); // Ensure we can get 3 symbols
        generatedReels.symbols.push([strip[pos], strip[pos + 1], strip[pos + 2]]);
        generatedReels.positions.push(pos);
        finalReelPositions[`${GAME_NAME}Reel${i+1}Pos`] = pos; // For UserGameState
    }
    // TODO: Implement sticky wild logic for respins/freespins:
    // If isRespin or (isFreeSpin and sticky wilds are active from MonsterHealth),
    // overwrite symbols at sticky positions with 'SYM_1' (Wild).
    // This will be handled more robustly below.
    let currentStickyWilds = userGameState[`${GAME_NAME}StickyWilds`] || []; // {reel: number, row: number}[]
    let newStickyWildsThisSpin: {reel: number, row: number}[] = [];


    // Apply incoming sticky wilds from previous spin/state
    if (isFreeSpin || isRespin) {
        currentStickyWilds.forEach((sticky: {reel: number, row: number}) => {
            if (generatedReels.symbols[sticky.reel] && generatedReels.symbols[sticky.reel][sticky.row] !== undefined) {
                generatedReels.symbols[sticky.reel][sticky.row] = wildSymbol;
            }
        });
    }


    // Check for new wilds on this spin to make them sticky for next respin/freespin
    if (isFreeSpin || isRespin || !isFreeSpin) { // In base game, new wilds trigger respin
        for (let r = 0; r < 5; r++) {
            for (let L = 0; L < 3; L++) {
                if (generatedReels.symbols[r][L] === wildSymbol) {
                    const isAlreadySticky = currentStickyWilds.some((sw: any) => sw.reel === r && sw.row === L);
                    if (!isAlreadySticky) {
                        newStickyWildsThisSpin.push({ reel: r, row: L });
                    }
                }
            }
        }
    }

    let triggerRespin = false;
    if (!isFreeSpin && !isRespin && newStickyWildsThisSpin.length > 0) {
        triggerRespin = true;
        currentStickyWilds = newStickyWildsThisSpin; // These become the sticky wilds for the first respin
    } else if (isRespin) {
        // For ongoing respins, new wilds stick and continue respins. If no new wilds, respin ends.
        if (newStickyWildsThisSpin.length > 0) {
            currentStickyWilds.push(...newStickyWildsThisSpin);
            triggerRespin = true; // Continue respins
        } else {
            triggerRespin = false; // End respins
        }
    }


    // --- Creature From The Black Lagoon Specific Feature Logic (Free Spins) ---
    let monsterHealth = userGameState[`${GAME_NAME}MonsterHealth`] ?? 0;
    let featureStage = Math.floor(monsterHealth / 3); // 0-2: stage 0, 3-5: stage 1, 6-8: stage 2, 9+: stage 3
    let additionalFreeSpinsAwarded = 0;

    if (isFreeSpin) {
        const targetSymbol = 'SYM_2'; // Target symbol
        if (generatedReels.symbols[4][1] === targetSymbol) { // Target on Reel 5, Middle Row (example position)
            monsterHealth++;
            const newFeatureStage = Math.floor(monsterHealth / 3);
            if (newFeatureStage > featureStage) { // Stage up
                featureStage = newFeatureStage;
                // Spreading wild logic will apply based on new stage
            }
            if (monsterHealth === 9 && !(userGameState[`${GAME_NAME}Level3FSAwarded`])) { // Max health target reached first time
                additionalFreeSpinsAwarded = 10;
                await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}Level3FSAwarded`, true);
            }
        }

        // Apply Spreading Wilds based on feature_stage
        if (featureStage > 0) {
            let wildsToSpread = 0;
            if (featureStage === 1) wildsToSpread = 1; // Stage 1 (health 3-5): 1 wild spreads
            if (featureStage === 2) wildsToSpread = 2; // Stage 2 (health 6-8): 2 wilds spread
            if (featureStage >= 3) wildsToSpread = Infinity; // Stage 3 (health 9+): All wilds spread (effectively)

            const existingWildPositionsThisSpin = new Set<string>();
            currentStickyWilds.forEach(sw => existingWildPositionsThisSpin.add(`${sw.reel},${sw.row}`));
            newStickyWildsThisSpin.forEach(sw => existingWildPositionsThisSpin.add(`${sw.reel},${sw.row}`));

            let spreadCount = 0;
            for (let r = 0; r < 5 && spreadCount < wildsToSpread; r++) {
                for (let L = 0; L < 3 && spreadCount < wildsToSpread; L++) {
                    if (generatedReels.symbols[r][L] === wildSymbol) {
                        // Try to spread left
                        if (r > 0 && generatedReels.symbols[r-1][L] !== wildSymbol) {
                            generatedReels.symbols[r-1][L] = wildSymbol;
                            if (!existingWildPositionsThisSpin.has(`${r-1},${L}`)) newStickyWildsThisSpin.push({reel: r-1, row: L});
                            spreadCount++;
                            if(spreadCount >= wildsToSpread && featureStage < 3) break; // Limit spreads unless stage 3
                        }
                        // Try to spread right
                        if (r < 4 && generatedReels.symbols[r+1][L] !== wildSymbol && (spreadCount < wildsToSpread || featureStage >=3)) {
                            generatedReels.symbols[r+1][L] = wildSymbol;
                             if (!existingWildPositionsThisSpin.has(`${r+1},${L}`)) newStickyWildsThisSpin.push({reel: r+1, row: L});
                            spreadCount++;
                            if(spreadCount >= wildsToSpread && featureStage < 3) break;
                        }
                    }
                }
                 if(spreadCount >= wildsToSpread && featureStage < 3) break;
            }
        }
        // Consolidate all sticky wilds for free spins
        currentStickyWilds.push(...newStickyWildsThisSpin);
        // Deduplicate currentStickyWilds
        const uniqueStickyWilds = new Map<string, {reel:number, row:number}>();
        currentStickyWilds.forEach(sw => uniqueStickyWilds.set(`${sw.reel},${sw.row}`, sw));
        currentStickyWilds = Array.from(uniqueStickyWilds.values());
    }


    // 5. Calculate Line Wins (using potentially modified generatedReels)
    let totalWinCoins = 0;
    const lineWinsArray: any[] = []; // For response: { lineId, symbol, count, winCoins }
    const wildSymbol = 'SYM_1'; // Assuming SYM_1 is Wild for Creature from the Black Lagoon

    for (let i = 0; i < PAYLINES.length; i++) {
        const payline = PAYLINES[i];
        const symbolsOnLine: string[] = [];
        for (let reelIdx = 0; reelIdx < payline.length; reelIdx++) {
            symbolsOnLine.push(generatedReels.symbols[reelIdx][payline[reelIdx]]);
        }

        let firstSymbol = symbolsOnLine[0];
        let matchCount = 0;
        let lineWilds = 0;

        // Check left-to-right
        for (let k = 0; k < symbolsOnLine.length; k++) {
            if (symbolsOnLine[k] === firstSymbol || symbolsOnLine[k] === wildSymbol) {
                matchCount++;
                if (symbolsOnLine[k] === wildSymbol && firstSymbol !== wildSymbol) { // Wild substituting a non-wild
                    lineWilds++;
                } else if (symbolsOnLine[k] !== wildSymbol && firstSymbol === wildSymbol && k > 0) {
                    // If the line started with wilds, the first non-wild determines the symbol type
                    firstSymbol = symbolsOnLine[k];
                }
            } else {
                break;
            }
        }

        // If line starts with Wilds, and all are wilds, firstSymbol remains wild.
        // Need to check if paytable has entries for pure wild wins.
        if (firstSymbol === wildSymbol && matchCount > 0 && lineWilds === matchCount) {
             // Pure wild line, check paytable for wild symbol payouts
        }


        const paytableEntry = gameConfig.paytable.find(
            (p) => p.symbol === firstSymbol && p.match_count === matchCount
        );

        if (paytableEntry && paytableEntry.payout_multiplier > 0) {
            const winForLineCoins = paytableEntry.payout_multiplier * betLevel;
            totalWinCoins += winForLineCoins;
            lineWinsArray.push({
                lineId: i + 1,
                symbol: firstSymbol,
                count: matchCount,
                winCoins: winForLineCoins,
                winCents: winForLineCoins * denom * 100,
            });
        }
    }

    const totalWinCurrency = totalWinCoins * denom;
    spinLogEntry.winAmount = totalWinCurrency;

    // Update userGameState with the outcomes of this spin
    if (isFreeSpin) {
        userGameState[`${GAME_NAME}CurrentFreeGame`] = (userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0) + 1;
        if (additionalFreeSpinsAwarded > 0) {
            userGameState[`${GAME_NAME}FreeGames`] = (userGameState[`${GAME_NAME}FreeGames`] ?? 0) + additionalFreeSpinsAwarded;
        }
        userGameState[`${GAME_NAME}MonsterHealth`] = monsterHealth;
        userGameState[`${GAME_NAME}StickyWilds`] = currentStickyWilds; // Save all current sticky wilds
        userGameState[`${GAME_NAME}BonusWin`] = (userGameState[`${GAME_NAME}BonusWin`] ?? 0) + totalWinCoins;
    } else if (isRespin) {
        if (triggerRespin) { // Respin continues
            userGameState[`${GAME_NAME}StickyWilds`] = currentStickyWilds;
        } else { // Respin ends
            delete userGameState[`${GAME_NAME}StickyWilds`];
            delete userGameState[`${GAME_NAME}IsRespinActive`]; // A flag to indicate respin mode
        }
    } else if (triggerRespin) { // Base game spin triggered a respin
        userGameState[`${GAME_NAME}StickyWilds`] = currentStickyWilds;
        userGameState[`${GAME_NAME}IsRespinActive`] = true;
        // Save current bet/denom for respins if not already part of userGameState
        userGameState[`${GAME_NAME}DenomForRespin`] = denom;
        userGameState[`${GAME_NAME}BetLevelForRespin`] = betLevel;
    }


    // 6. Scatter Handling & Free Spin Trigger (Simplified) - This was for initial trigger
    // Scatter symbol for CFTBL is 'SYM_0'
    let scatterCount = 0;
    generatedReels.symbols.forEach(reelSymbols => {
        reelSymbols.forEach(symbol => {
            if (symbol === 'SYM_0') scatterCount++;
        });
    });

    let freeSpinsTriggered = 0; // This is for initial trigger from base game
    // let scatterWinCoins = 0; // Scatter wins are usually part of paytable lookup

    if (!isFreeSpin && !isRespin && scatterCount >= 3) { // Initial trigger only
        // From Paytable: SYM_0 for scatter wins (usually 0 multiplier, triggers free spins)
        // Free spins count from gameConfig.settings.slotFreeCount (array: [0,0,0,10,15,20] for 0,1,2,3,4,5 scatters)
        const fsCounts = gameConfig.settings?.slotFreeCount || [0,0,0,10,15,20]; // [0sc,1sc,2sc,3sc,4sc,5sc] -> free games
        freeSpinsTriggered = fsCounts[Math.min(scatterCount, fsCounts.length -1)] || 0;

        if (freeSpinsTriggered > 0) {
            userGameState[`${GAME_NAME}FreeGames`] = freeSpinsTriggered;
            userGameState[`${GAME_NAME}CurrentFreeGame`] = 0; // Will be incremented at start of first free spin
            userGameState[`${GAME_NAME}BonusWin`] = 0;
            userGameState[`${GAME_NAME}MonsterHealth`] = 0;
            userGameState[`${GAME_NAME}StickyWilds`] = []; // Clear previous sticky wilds
            userGameState[`${GAME_NAME}Level3FSAwarded`] = false; // Reset flag for +10 FS
        }
    }

    // 9. Update Balance (add winnings) & Persist All User Game States
    let finalUser = user; // User object that might be updated by balance change
    if (totalWinCurrency > 0) {
        const winUpdateArgs: UpdateUserBalanceArgs = {
            userId,
            amount: totalWinCurrency,
            transactionType: isFreeSpin ? 'freespin_win' : (isRespin ? 'respin_win' : 'spin_win'),
            systemName: isFreeSpin ? 'freespin' : (isRespin ? 'respin' : 'spin'),
        };
        finalUser = await UserService.updateUserBalance(winUpdateArgs) || user; // Fallback to original user if update fails
    }
    spinLogEntry.userBalanceAfterSpin = finalUser.balance ?? 0;

    // Persist all accumulated game state changes
    for (const key in finalReelPositions) { // Save current reel positions
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, finalReelPositions[key]);
    }
    // Save other states modified within _performSpinLogic or by callers
    for (const key in userGameState) {
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, userGameState[key]);
    }


    // 10. Construct Response Object
    let nextAction = "spin";
    let gameIsOver = true;
    if (isFreeSpin && userGameState[`${GAME_NAME}CurrentFreeGame`] < userGameState[`${GAME_NAME}FreeGames`]) {
        nextAction = "freespin";
        gameIsOver = false;
    } else if (triggerRespin) {
        nextAction = "respin";
        gameIsOver = false;
    } else if (freeSpinsTriggered > 0) { // Just triggered FS from a base spin
        nextAction = "freespin"; // Client should init free spins
        gameIsOver = false;
    }

    // If free spins just ended
    if (isFreeSpin && userGameState[`${GAME_NAME}CurrentFreeGame`] >= userGameState[`${GAME_NAME}FreeGames`]) {
        nextAction = "spin"; // Back to base game
        gameIsOver = true;
        // Clear free spin related states
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}FreeGames`, 0);
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}CurrentFreeGame`, 0);
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}StickyWilds`, []);
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}MonsterHealth`, 0);
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}Level3FSAwarded`, false);
    }
    // If respins just ended
    if (isRespin && !triggerRespin) {
        nextAction = "spin";
        gameIsOver = true;
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}StickyWilds`, []);
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}IsRespinActive`, false);
    }


    const responseObject: Record<string, any> = {
        clientaction: isFreeSpin ? 'freespin' : (isRespin ? 'respin' : 'spin'),
        credit: Math.round((finalUser.balance ?? 0) * 100),
        gameover: gameIsOver.toString(),
        nextaction: nextAction,
        gamestate_current: isFreeSpin ? `freespin${featureStage}` : (isRespin || triggerRespin ? 'respin' : 'basic'),
        bet_denomination: denom * 100,
        bet_betlevel: betLevel,
        bet_lines: lines,
        // Reel display
        ...(() => { // Format reel data as rs.i0.r.iX.syms and pos
            const reelData: Record<string, string> = {};
            for (let r = 0; r < 5; r++) {
                const currentReelSymbols = generatedReels.symbols[r];
                reelData[`rs.i0.r.i${r}.syms`] = `${currentReelSymbols[0]}%2C${currentReelSymbols[1]}%2C${currentReelSymbols[2]}`;
                reelData[`rs.i0.r.i${r}.pos`] = generatedReels.positions[r].toString();
            }
            return reelData;
        })(),
        // Sticky/Overlay Wilds for response (simplified)
        // PHP format: rs.i0.r.0.overlay.i0.row=1&rs.i0.r.0.overlay.i0.with=SYM_1&...
        ...(() => {
            const overlayData: Record<string, string> = {};
            let overlayIndex = 0;
            currentStickyWilds.forEach((sw: any) => {
                 // Assuming only one overlay set 'rs.i0.'
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${overlayIndex}.row`] = sw.row.toString();
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${overlayIndex}.with`] = wildSymbol; // SYM_1
                // PHP might have a specific 'pos' for overlays too, not just row.
                overlayIndex++;
            });
            return overlayData;
        })(),

        game_win_cents: Math.round(totalWinCurrency * 100),
        game_win_coins: totalWinCoins,
        totalwin_cents: isFreeSpin ? Math.round((userGameState[`${GAME_NAME}BonusWin`] ?? 0) * denom * 100) : Math.round(totalWinCurrency * 100),
        totalwin_coins: isFreeSpin ? (userGameState[`${GAME_NAME}BonusWin`] ?? 0) : totalWinCoins,

        freespins_total: userGameState[`${GAME_NAME}FreeGames`] ?? 0,
        freespins_left: Math.max(0, (userGameState[`${GAME_NAME}FreeGames`] ?? 0) - (userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0)),
        freespins_multiplier: 1, // CFTBL doesn't have a general multiplier, but feature stage implies wild changes
        freespins_totalwin_cents: Math.round((userGameState[`${GAME_NAME}BonusWin`] ?? 0) * denom * 100),
        freespins_totalwin_coins: userGameState[`${GAME_NAME}BonusWin`] ?? 0,

        feature_stage: `stage${featureStage}`, // Monster health stage
        collectablesWon: monsterHealth, // Monster health points

        // Additional fields from analyzing a typical NetEnt response
        doublemoney: "false",
        matrix Centrertrld: generatedReels.symbols.map(r => r.join(',')).join(';'), // Example flat matrix
        roundid: `round-${Date.now()}`, // Unique round ID
        actionid: `action-${Date.now()}`,
        // line_wins details are important for client animation
        // Example: wl.i0.l=1&wl.i0.s=SYM_4&wl.i0.c=3&wl.i0.w=50&...
        ...lineWinsArray.reduce((acc, lw, idx) => {
            acc[`wl.i${idx}.l`] = lw.lineId.toString();
            acc[`wl.i${idx}.s`] = lw.symbol;
            acc[`wl.i${idx}.c`] = lw.count.toString();
            acc[`wl.i${idx}.w`] = lw.winCoins.toString();
            return acc;
        }, {} as Record<string, string>),

        _message: "Spin logic with features (sticky/spreading wilds, monster health) partially implemented.",
    };

    // 11. Log Spin
    spinLogEntry.responseData = JSON.stringify(responseObject);
    // TODO: Populate bank details (toGameBanks, betProfit) in spinLogEntry more accurately.
    await LogService.logGameSpin(spinLogEntry as GameSpinLogData);

    return c.json(responseObject);
}


const handleInit = async (c: Context) => {
  const jwtPayload = c.get('user');
  // Ensure sub is treated as number if your user IDs are numeric
  const userIdString = jwtPayload?.sub;

  if (!userIdString) {
    return c.json({ error: 'User ID not found in token' }, 401);
  }
  const userId = parseInt(userIdString, 10);

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID format in token' }, 400);
  }

  const sessid = c.req.query('sessid'); // Session ID from client, if used for anything
  console.log(`[${GAME_NAME}] Init action called for user ${userId}, client session ${sessid}`);
  console.log(`[${GAME_NAME}] All Query Params:`, c.req.query());

  try {
    const user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (!gameConfig) return c.json({ error: `Game configuration not found for ${GAME_NAME}` }, 500);

    // Initialize/reset some user game states for this game upon init
    // This is a simplified approach. PHP logic might be more conditional.
    // These keys are specific to CreatureFromTheBlackLagoonNET based on its SlotSettings.php
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}BonusWin`, 0);
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}FreeGames`, 0);
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}CurrentFreeGame`, 0);
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}TotalWin`, 0);
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}MonsterHealth`, 0); // CFTBL specific state
    // 'FreeBalance' in PHP seems to be user.balance; 'Denom' and 'Bet' are part of game state.
    // Let's assume current denomination and bet level are stored or defaulted.

    const defaultDenom = gameConfig.settings?.Denominations?.[0] ?? gameConfig.denomination ?? 0.01;
    const defaultBetLevel = gameConfig.settings?.bet_levels?.[0] ?? 1;

    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}Denom`, defaultDenom);
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}BetLevel`, defaultBetLevel);


    // Load all game states for this user and game to see if we need to restore anything
    const userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);

    // Constructing the response object. This needs to match the PHP server's URL-encoded string structure.
    // The PHP response is a flat key-value structure.
    // Example from PHP: "rs.i0.r.i0.syms=SYM_7%2CSYM_0%2CSYM_7&rs.i0.r.i0.pos=0&..."
    // We will build a JSON object that the client-side will then need to handle.
    // If the client strictly expects URL-encoded, Hono can set Content-Type and body accordingly.
    // For now, returning JSON and noting client adaptation might be needed.

    const balanceInCents = Math.round((user.balance ?? 0) * 100); // Assuming balance is in currency units

    // Simplified initial reel display (placeholder - PHP logic is complex)
    // The game client expects specific symbols based on reel strips.
    // PHP's `curReels` string is generated if no history or not in free spins.
    let rs_i0_r_iX_syms: Record<string, string> = {};
    let rs_i0_r_iX_pos: Record<string, string> = {};

    for (let i = 0; i < 5; i++) { // 5 reels for CFTBL
        const reelStripKey = `reelStrip${i + 1}`; // e.g., reelStrip1
        const reelStrip = gameConfig.reel_strips[reelStripKey] || [];
        const pos = userGameState[`${GAME_NAME}Reel${i+1}Pos`] ?? Math.floor(Math.random() * Math.max(1, reelStrip.length - 2));

        const sym1 = reelStrip[pos] || 'SYM_0'; // Default symbol if strip is short/pos is off
        const sym2 = reelStrip[pos + 1] || 'SYM_0';
        const sym3 = reelStrip[pos + 2] || 'SYM_0';

        rs_i0_r_iX_syms[`rs.i0.r.i${i}.syms`] = `${sym1}%2C${sym2}%2C${sym3}`; // URL encoded comma
        rs_i0_r_iX_pos[`rs.i0.r.i${i}.pos`] = pos.toString();
    }

    // Check for active free spins to determine game state
    const freeGamesLeft = userGameState[`${GAME_NAME}FreeGames`] ?? 0;
    const currentFreeGame = userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0;
    let gameStateCurrent = "basic"; // 'basic', 'freespinA', 'freespinB', 'freespinC' etc.
    let nextAction = "spin";
    let freeSpinsTotal = 0;
    let freeSpinsLeft = 0;
    let freeSpinsMultiplier = 1; // CFTBL has multiplier based on monster health in free spins
    let freeSpinsTotalWinCents = 0;

    if (freeGamesLeft > 0 && currentFreeGame > 0 && currentFreeGame <= freeGamesLeft) {
        gameStateCurrent = `freespin${userGameState[`${GAME_NAME}MonsterHealth`] || 'A'}`; // Or more specific state
        nextAction = "freespin";
        freeSpinsTotal = freeGamesLeft;
        freeSpinsLeft = freeGamesLeft - currentFreeGame +1; // Adjust based on how CurrentFreeGame is counted
        // freeSpinsMultiplier might depend on MonsterHealth state
        freeSpinsTotalWinCents = (userGameState[`${GAME_NAME}BonusWin`] ?? 0) * 100 * defaultDenom;
    }


    const responseObject: Record<string, any> = {
      clientaction: 'init',
      playercurrencyiso: user.currency || 'EUR', // Default if not set
      jackpotcurrencyiso: user.currency || 'EUR',
      credit: balanceInCents, // User's total balance in cents
      gameover: freeGamesLeft > 0 ? 'false' : 'true', // True if not in active free spins
      nextaction: nextAction,
      gamestate_current: gameStateCurrent,
      // Denominations and Bet Levels (example, needs to pull from gameConfig.settings)
      denomination_all: (gameConfig.settings?.Denominations || [0.01, 0.02, 0.05, 0.10, 0.20]).map(d => d*100).join('%2C'), // in cents
      betlevel_all: (gameConfig.settings?.bet_levels || [1, 2, 3, 4, 5, 10]).join('%2C'),
      bet_denomination: (userGameState[`${GAME_NAME}Denom`] ?? defaultDenom) * 100, // in cents
      bet_betlevel: userGameState[`${GAME_NAME}BetLevel`] ?? defaultBetLevel,
      bet_lines: gameConfig.settings?.lines ?? 20, // Assuming fixed lines for CFTBL

      // Reel display (simplified)
      ...rs_i0_r_iX_syms,
      ...rs_i0_r_iX_pos,
      // rs.i1 would be for the feature reel strips (e.g. sticky wilds in CFTBL) - needs population if feature active

      // Win amounts (initially 0)
      game_win_cents: 0,
      game_win_coins: 0,
      totalwin_cents: freeSpinsTotalWinCents, // Total win in current free spin session
      totalwin_coins: freeSpinsTotalWinCents / ((userGameState[`${GAME_NAME}Denom`] ?? defaultDenom) * 100),

      // Free spins related fields
      freespins_total: freeSpinsTotal,
      freespins_left: freeSpinsLeft,
      freespins_multiplier: freeSpinsMultiplier,
      freespins_totalwin_cents: freeSpinsTotalWinCents,
      freespins_totalwin_coins: freeSpinsTotalWinCents / ((userGameState[`${GAME_NAME}Denom`] ?? defaultDenom) * 100),

      // Creature From The Black Lagoon specific state
      feature_stage: `stage${userGameState[`${GAME_NAME}MonsterHealth`] || 0}`, // e.g. stage0, stage1, stage2, stage3

      // Static or less dynamic values often found in PHP init response
      flashvars_gameRulesUrl: "/rules/CreatureFromTheBlackLagoonNET/rules_en.html", // Example
      flashvars_helpUrl: "/rules/CreatureFromTheBlackLagoonNET/rules_en.html", // Example
      flashvars_lang: "en",
      // ... many other potential fields from PHP's init string
      // It's crucial to capture all necessary fields the client expects.
      // This response is still a partial representation.
      _message: "Init action partially implemented. Response structure needs to be carefully matched with PHP output.",
    };

    // TODO: Log this init action if necessary, though init usually doesn't have bet/win.
    // LogService.logGameSpin({ userId, gameId: gameConfig.id, gameName: GAME_NAME, responseData: JSON.stringify(responseObject), betAmount: 0, winAmount: 0, userBalanceAfterSpin: user.balance });

    return c.json(responseObject);

  } catch (error: any) {
    console.error(`[${GAME_NAME}] Error in handleInit:`, error);
    return c.json({ error: 'Internal server error', details: error.message }, 500);
  }
};

const handleSpin = async (c: Context) => {
  const userId = c.get('user')?.sub;
  const betLevel = c.req.query('bet_betlevel');
  const denomination = c.req.query('bet_denomination');
  console.log(`[${gameName}] Spin action called for user ${userId}`);
  console.log(`[${gameName}] BetLevel: ${betLevel}, Denomination: ${denomination}, All Query Params:`, c.req.query());
  // TODO: Implement spin logic: place bet, update balance, determine win, log spin.
  return c.json({
    message: 'Spin action processed',
    userId,
    query: c.req.query(),
    data: { /* Placeholder for actual spin response structure from PHP */ }
  });
};

const handleFreeSpin = async (c: Context) => {
  const jwtPayload = c.get('user');
  const userIdString = jwtPayload?.sub;
  if (!userIdString) return c.json({ error: 'User ID not found in token' }, 401);
  const userId = parseInt(userIdString, 10);
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID format' }, 400);

  console.log(`[${gameName}] FreeSpin action called for user ${userId}`);
  console.log(`[${gameName}] All Query Params:`, c.req.query());

  try {
    const user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);
    if (!user || !gameConfig) return c.json({ error: 'User or game config not found' }, 500);

    let userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);

    const currentFreeGamesTotal = userGameState[`${GAME_NAME}FreeGames`] ?? 0;
    let currentFreeGameNumber = userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0;

    if (currentFreeGameNumber >= currentFreeGamesTotal) {
      // Should not happen if client behaves, or free spins ended.
      // Clear states and return to base game or an error.
      await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}FreeGames`, 0);
      await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}CurrentFreeGame`, 0);
      await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}StickyWilds`, []);
      await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}MonsterHealth`, 0);
      return c.json({ error: 'No free spins left or invalid state.', nextaction: 'spin', gameover: 'true' });
    }

    // currentFreeGameNumber is 0-indexed for userGameState but 1-indexed for logic/display usually
    // If CurrentFreeGame stored 0 for the 1st spin, then it's fine. If it stored 1, then it's fine.
    // Assuming CurrentFreeGame in UGS means "next spin to play" (1-indexed for user) or "spins played" (0-indexed for user)
    // The _performSpinLogic will increment it conceptually for its processing, then we save it.
    // Let's assume userGameState.CurrentFreeGame stores the number of FS played (0 before first).
    // The _performSpinLogic will handle the current spin as userGameState.CurrentFreeGame + 1 conceptually.

    const denom = userGameState[`${GAME_NAME}Denom`] ?? (gameConfig.settings?.Denominations?.[0] ?? gameConfig.denomination ?? 0.01);
    const betLevel = userGameState[`${GAME_NAME}BetLevel`] ?? (gameConfig.settings?.bet_levels?.[0] ?? 1);

    // Call shared spin logic with isFreeSpin = true
    // _performSpinLogic will internally handle incrementing CurrentFreeGame conceptually for this spin
    // and other free spin specific logic like monster health.
    // It will return the new state of sticky wilds, monster health, etc.
    // The userGameState object is passed and can be modified by _performSpinLogic for some parts.
    return _performSpinLogic(c, userId, user, gameConfig, userGameState, betLevel, denom, true, false);

  } catch (error: any) {
    console.error(`[${GAME_NAME}] Error in handleFreeSpin:`, error);
    return c.json({ error: 'Internal server error', details: error.message }, 500);
  }
};

const handleRespin = async (c: Context) => {
  const jwtPayload = c.get('user');
  const userIdString = jwtPayload?.sub;
  if (!userIdString) return c.json({ error: 'User ID not found in token' }, 401);
  const userId = parseInt(userIdString, 10);
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID format' }, 400);

  console.log(`[${gameName}] Respin action called for user ${userId}`);
  console.log(`[${gameName}] All Query Params:`, c.req.query());

  try {
    const user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);
    if (!user || !gameConfig) return c.json({ error: 'User or game config not found' }, 500);

    let userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);

    if (!(userGameState[`${GAME_NAME}IsRespinActive`]) || !userGameState[`${GAME_NAME}StickyWilds`]?.length) {
        return c.json({ error: 'No active respin state found.', nextaction: 'spin', gameover: 'true' });
    }

    const denom = userGameState[`${GAME_NAME}DenomForRespin`] ?? userGameState[`${GAME_NAME}Denom`] ?? (gameConfig.settings?.Denominations?.[0] ?? gameConfig.denomination ?? 0.01);
    const betLevel = userGameState[`${GAME_NAME}BetLevelForRespin`] ?? userGameState[`${GAME_NAME}BetLevel`] ?? (gameConfig.settings?.bet_levels?.[0] ?? 1);

    // Respins are free, use original bet settings.
    // _performSpinLogic will handle sticky wilds from userGameState.
    return _performSpinLogic(c, userId, user, gameConfig, userGameState, betLevel, denom, false, true);

  } catch (error: any) {
    console.error(`[${GAME_NAME}] Error in handleRespin:`, error);
    return c.json({ error: 'Internal server error', details: error.message }, 500);
  }
};

const handlePaytable = async (c: Context) => {
  const jwtPayload = c.get('user');
  // User ID might not be strictly necessary for a static paytable, but good for consistency or if any user-specific aspect existed.
  const userIdString = jwtPayload?.sub;
  let userId: number | undefined = undefined;
  if (userIdString) {
    userId = parseInt(userIdString, 10);
    if (isNaN(userId)) {
        console.warn(`[${GAME_NAME}] Paytable: Invalid user ID format in token, proceeding without user context for paytable.`);
        userId = undefined;
    }
  }
  console.log(`[${GAME_NAME}] Paytable action called by user ${userId || 'N/A'}`);

  try {
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);
    if (!gameConfig) {
      return c.json({ error: `Game configuration not found for ${GAME_NAME}` }, 500);
    }

    let user = null;
    if (userId) {
        user = await UserService.getUserById(userId); // For currency info and balance
    }

    // Basic structure mirroring parts of a NetEnt paytable response
    // The PHP response is often a URL-encoded string of flat key-values.
    // We build a structured JSON object that represents this data.
    const paytableResponse: Record<string, any> = {
      clientaction: 'paytable',
      // Common static values often repeated in paytable responses
      // Denominations should be in cents for NetEnt style responses
      denomination_all: (gameConfig.settings?.Denominations || gameConfig.settings?.denomination_all || [0.01, 0.02, 0.05]).map((d:number) => d*100).join('%2C'),
      betlevel_all: (gameConfig.settings?.bet_levels || gameConfig.settings?.betlevel_all || [1,2,3,4,5,10]).join('%2C'),
      playercurrencyiso: user?.currency || gameConfig.settings?.playercurrencyiso || 'EUR',
      jackpotcurrencyiso: user?.currency || gameConfig.settings?.jackpotcurrencyiso || 'EUR',
      gamesoundurl: gameConfig.settings?.gamesoundurl || "https://static.casinomodule.com/games/netent/creaturefromtheblacklagoon/031213_202046/", // Example
      gameServerVersion: gameConfig.settings?.gameServerVersion || "1.5.0", // Example
      credit: user ? Math.round((user.balance ?? 0) * 100) : 0, // Current balance in cents
      // casinoID: gameConfig.settings?.casinoID || "netent", // Example

      pt: { // Paytable section
        i0: { // Instance 0 (basic game paytable)
          id: 'basic', // Standard ID for basic paytable
          comp: [] // Array of paytable components (symbol payouts)
        }
        // pt.i1 could be for freespin paytable if it differs significantly and needs separate listing
      },
      // Placeholder for bet line definitions (bl.iX.line, bl.iX.id)
      // These are static and should come from gameConfig.settings if they were stored there.
      // Example: "bl.i0.line=1%2C1%2C1%2C1%2C1&bl.i0.id=0&..."
      // For now, we'll assume client might have this or it's part of init.
      // If needed, iterate over PAYLINES constant and format them.
    };

    // Populate paytable components from gameConfig.paytable (GamePaytableEntry[])
    if (gameConfig.paytable && gameConfig.paytable.length > 0) {
      gameConfig.paytable.forEach(entry => {
        const payoutMultiplier = Number(entry.payout_multiplier);
        if (isNaN(payoutMultiplier)) {
            console.warn(`[${GAME_NAME}] Invalid payout_multiplier for symbol ${entry.symbol}, match_count ${entry.match_count}`);
            return; // Skip this entry
        }

        const component = {
          symbol: entry.symbol,         // e.g., "SYM_3"
          n: entry.match_count,       // e.g., 3 (number of matches)
          multi: payoutMultiplier,    // The payout multiplier for the bet per line (coins)
          type: 'betline',            // Assuming most are betline wins; could be 'scatter' if schema supports this distinction
          freespins: 0                // Typically 0 for direct symbol match payouts in main table
                                      // Scatter symbols might have this as non-zero in some games.
        };
        (paytableResponse.pt.i0.comp as any[]).push(component);
      });
    } else {
        console.warn(`[${GAME_NAME}] No paytable entries found in gameConfig.`);
    }

    // Add information about specific game features if available in settings
    // This part is highly game-specific.
    if (gameConfig.settings?.feature_details) {
        paytableResponse.feature_details = gameConfig.settings.feature_details;
    }
    if (gameConfig.settings?.freespin_rules) {
        paytableResponse.freespin_rules = gameConfig.settings.freespin_rules;
    }
     // Add bet line definitions from the PAYLINES constant
    PAYLINES.forEach((lineCoords, index) => {
        paytableResponse[`bl.i${index}.line`] = lineCoords.join('%2C');
        paytableResponse[`bl.i${index}.id`] = index.toString();
    });


    return c.json(paytableResponse);

  } catch (error: any) {
    console.error(`[${GAME_NAME}] Error in handlePaytable:`, error);
    return c.json({ error: 'Internal server error', details: error.message }, 500);
  }
};

const handleReloadBalance = async (c: Context) => { // Maps to 'init' in PHP essentially for balance update
  const userId = c.get('user')?.sub;
  console.log(`[${gameName}] ReloadBalance action called (maps to init for balance refresh) for user ${userId}`);
  console.log(`[${gameName}] All Query Params:`, c.req.query());
  // TODO: Fetch user balance, potentially other minimal init data.
  // const balance = await UserService.getUserBalance(parseInt(userId));
  return c.json({
    message: 'ReloadBalance action processed (maps to init for balance)',
    userId,
    query: c.req.query(),
    data: { /* Placeholder for balance and minimal init data */ }
   });
};

const handleInitFreeSpin = async (c: Context) => {
    const userId = c.get('user')?.sub;
    console.log(`[${gameName}] InitFreeSpin action called for user ${userId}`);
    console.log(`[${gameName}] All Query Params:`, c.req.query());
    // TODO: Initialize free spin mode, fetch current free spin count, etc.
    return c.json({
        message: 'InitFreeSpin action processed',
        userId,
        query: c.req.query(),
        data: { /* Placeholder for init free spin response */ }
    });
};


export const CreatureFromTheBlackLagoonNETController = {
  handleInit,
  handleSpin,
  handleFreeSpin,
  handleRespin,
  handlePaytable,
  handleReloadBalance,
  handleInitFreeSpin,
};
