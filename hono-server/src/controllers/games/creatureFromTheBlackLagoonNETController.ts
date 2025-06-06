// hono-server/src/controllers/games/creatureFromTheBlackLagoonNETController.ts
import { Context } from 'hono';
import { UserService, UpdateUserBalanceArgs } from '../../services/UserService';
import { GameConfigService, FullGameConfig } from '../../services/GameConfigService';
import { UserGameStateService } from '../../services/UserGameStateService';
import { BankService } from '../../services/BankService';
import { LogService, GameSpinLogData } from '../../services/LogService';
import { User } from '@prisma/client';

const GAME_NAME = 'CreatureFromTheBlackLagoonNET';

const WILD_SYMBOL_CFTBL = 'SYM_1';
const SCATTER_SYMBOL_CFTBL = 'SYM_0';
const TARGET_SYMBOL_CFTBL = 'SYM_2';

const PAYLINES: number[][] = [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
    [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1],
    [1,2,1,0,1],[0,1,1,1,0],[2,1,1,1,2],[1,1,0,1,1],[1,1,2,1,1],
    [0,1,2,1,2],[2,1,0,1,0],[1,0,2,0,1],[1,2,0,2,1],[0,2,2,2,0]
];

// --- Shared Spin Logic ---
async function _performSpinLogic(
    userId: number,
    gameConfig: FullGameConfig,
    currentUserGameState: Record<string, any>,
    betLevel: number,
    denom: number,
    isFreeSpin: boolean,
    isRespin: boolean
): Promise<{
    userGameStateChanges: Record<string, any>;
    // Data for response construction:
    finalReelSymbols: string[][]; // symbols on screen after all features
    finalReelPositions: number[]; // stop positions for these reels
    totalWinCoins: number;
    lineWins: any[]; // Formatted for response
    scatterCount: number;
    nextAction: string;
    gameIsOver: boolean;
    currentStickyWildsResult: { reel: number, row: number, symbol: string }[];
    monsterHealthResult: number;
    featureStageResult: number;
    freeSpinsAwardedThisSpinResult: number;
    freeSpinsLeftResult: number;
    freeSpinsTotalResult: number;
    currentFreeGameResult: number;
    bonusWinCoinsResult: number;
}> {
    const lines = PAYLINES.length;
    const betPerLineCoins = betLevel;
    const userGameStateChanges: Record<string, any> = {};

    let currentStickyWilds: { reel: number, row: number, symbol: string }[] =
        (isFreeSpin || isRespin) ? (currentUserGameState[`${GAME_NAME}StickyWilds`] || []) : [];

    const generatedReels: { symbols: string[][], positions: number[] } = { symbols: [], positions: [] };
    for (let i = 0; i < 5; i++) {
        const reelStripKey = isFreeSpin ?
            (gameConfig.reel_strips[`reelStripBonus${i + 1}`] ? `reelStripBonus${i + 1}` : `reelStrip${i + 1}`)
            : `reelStrip${i + 1}`;
        const strip = gameConfig.reel_strips[reelStripKey] || ['SYM_X','SYM_X','SYM_X'];
        if (strip.length < 3) {
            generatedReels.symbols.push(['SYM_X', 'SYM_X', 'SYM_X']);
            generatedReels.positions.push(0);
            continue;
        }
        const pos = Math.floor(Math.random() * (strip.length - 2 < 0 ? 0 : strip.length - 2));
        generatedReels.symbols.push([strip[pos], strip[pos + 1], strip[pos + 2]]);
        generatedReels.positions.push(pos);
    }
    userGameStateChanges[`${GAME_NAME}Reels`] = { symbols: generatedReels.symbols, positions: generatedReels.positions };

    let reelsForWinCalc = JSON.parse(JSON.stringify(generatedReels.symbols));
    currentStickyWilds.forEach(sw => {
        if (reelsForWinCalc[sw.reel]?.[sw.row] !== undefined) reelsForWinCalc[sw.reel][sw.row] = sw.symbol;
    });

    let newWildsFromSpinThisTurn: { reel: number, row: number, symbol: string }[] = [];
    if (!isFreeSpin) {
        for (let r = 0; r < 5; r++) {
            for (let L = 0; L < 3; L++) {
                if (generatedReels.symbols[r][L] === WILD_SYMBOL_CFTBL) {
                    const isAlreadySticky = currentStickyWilds.some(sw => sw.reel === r && sw.row === L);
                    if (!isAlreadySticky) newWildsFromSpinThisTurn.push({ reel: r, row: L, symbol: WILD_SYMBOL_CFTBL });
                }
            }
        }
    }

    let triggerRespin = false;
    if (!isFreeSpin && !isRespin && newWildsFromSpinThisTurn.length > 0) {
        triggerRespin = true;
        currentStickyWilds = [...newWildsFromSpinThisTurn];
    } else if (isRespin) {
        if (newWildsFromSpinThisTurn.length > 0) {
            currentStickyWilds.push(...newWildsFromSpinThisTurn);
            triggerRespin = true;
        } else {
            triggerRespin = false;
        }
    }

    let monsterHealth = currentUserGameState[`${GAME_NAME}MonsterHealth`] ?? 0;
    let featureStage = Math.floor(monsterHealth / 3);
    let additionalFsAwarded = 0;

    if (isFreeSpin) {
        for(let rowIdx = 0; rowIdx < 3; rowIdx++){
            if (generatedReels.symbols[4][rowIdx] === TARGET_SYMBOL_CFTBL) {
                monsterHealth++;
                featureStage = Math.floor(monsterHealth / 3);
                if (monsterHealth >= 9 && !(currentUserGameState[`${GAME_NAME}Level3FSAwarded`])) {
                    additionalFsAwarded = 10;
                    userGameStateChanges[`${GAME_NAME}Level3FSAwarded`] = true;
                }
                break;
            }
        }

        let tempReelsAfterSpreading = JSON.parse(JSON.stringify(reelsForWinCalc));
        if (featureStage >= 1) {
            const wildsOnScreen = [];
            for (let r = 0; r < 5; r++) for (let L = 0; L < 3; L++) if (tempReelsAfterSpreading[r][L] === WILD_SYMBOL_CFTBL) wildsOnScreen.push({r,L});

            let spreadInitiatorCount = 0;
            const maxSpreadInitiators = (featureStage === 1) ? 1 : (featureStage >= 2 ? 2 : Infinity); // Stage 3 all wilds spread.

            for (const wildPos of wildsOnScreen) {
                if (spreadInitiatorCount >= maxSpreadInitiators && featureStage < 3) break;
                let hasSpreadFromThisWild = false;
                if (wildPos.r > 0 && tempReelsAfterSpreading[wildPos.r - 1][wildPos.L] !== WILD_SYMBOL_CFTBL) {
                    tempReelsAfterSpreading[wildPos.r - 1][wildPos.L] = WILD_SYMBOL_CFTBL; hasSpreadFromThisWild = true;
                }
                if ((featureStage >= 2 || (featureStage === 1 && !hasSpreadFromThisWild)) && wildPos.r < 4 && tempReelsAfterSpreading[wildPos.r + 1][wildPos.L] !== WILD_SYMBOL_CFTBL) {
                    tempReelsAfterSpreading[wildPos.r + 1][wildPos.L] = WILD_SYMBOL_CFTBL; hasSpreadFromThisWild = true;
                }
                if(hasSpreadFromThisWild) spreadInitiatorCount++;
            }
        }
        reelsForWinCalc = tempReelsAfterSpreading;

        currentStickyWilds = [];
        for (let r = 0; r < 5; r++) for (let L = 0; L < 3; L++) if (reelsForWinCalc[r][L] === WILD_SYMBOL_CFTBL) currentStickyWilds.push({ reel: r, row: L, symbol: WILD_SYMBOL_CFTBL });
    }

    const uniqueStickyMap = new Map<string, {reel:number, row:number, symbol:string}>();
    currentStickyWilds.forEach(sw => uniqueStickyMap.set(`${sw.reel},${sw.row}`, sw));
    userGameStateChanges[`${GAME_NAME}StickyWilds`] = Array.from(uniqueStickyMap.values());
    userGameStateChanges[`${GAME_NAME}MonsterHealth`] = monsterHealth;


    let totalWinCoins = 0;
    const lineWinsArray: any[] = [];
    for (let i = 0; i < PAYLINES.length; i++) {
        const payline = PAYLINES[i];
        const symbolsOnLine: string[] = []; const symbolPositionsOnLine: { col: number, row: number }[] = []; // col is reelIdx
        for (let reelIdx = 0; reelIdx < payline.length; reelIdx++) {
            symbolsOnLine.push(reelsForWinCalc[reelIdx][payline[reelIdx]]);
            symbolPositionsOnLine.push({ col: reelIdx, row: payline[reelIdx] });
        }
        let firstSymbol = symbolsOnLine[0];
        if (firstSymbol === WILD_SYMBOL_CFTBL) {
            let k = 1; while(k < symbolsOnLine.length && symbolsOnLine[k] === WILD_SYMBOL_CFTBL) k++;
            if (k < symbolsOnLine.length && symbolsOnLine[k] !== SCATTER_SYMBOL_CFTBL) firstSymbol = symbolsOnLine[k];
        }
        let matchCount = 0;
        for (let k = 0; k < symbolsOnLine.length; k++) {
            if (symbolsOnLine[k] === firstSymbol || symbolsOnLine[k] === WILD_SYMBOL_CFTBL) matchCount++; else break;
        }
        const paytableEntry = gameConfig.paytable.find(p => p.symbol === firstSymbol && p.match_count === matchCount);
        if (paytableEntry && paytableEntry.payout_multiplier > 0) {
            const winForLineCoins = Number(paytableEntry.payout_multiplier) * betLevel;
            totalWinCoins += winForLineCoins;
            lineWinsArray.push({ lineIndex: i, symbol: firstSymbol, numSymbols: matchCount, winCoins: winForLineCoins, positions: symbolPositionsOnLine.slice(0, matchCount) });
        }
    }

    let scatterCount = 0;
    for (let r = 0; r < 5; r++) for (let L = 0; L < 3; L++) if (reelsForWinCalc[r][L] === SCATTER_SYMBOL_CFTBL) scatterCount++;

    let nextAction = "spin"; let gameIsOver = true; let freeSpinsAwardedThisSpin = 0;
    let currentFsTotal = currentUserGameState[`${GAME_NAME}FreeGames`] ?? 0;
    let currentFsPlayed = currentUserGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0;
    let currentBonusWin = currentUserGameState[`${GAME_NAME}BonusWin`] ?? 0;


    if (!isFreeSpin && !isRespin && triggerRespin) {
        userGameStateChanges[`${GAME_NAME}IsRespinActive`] = true;
        userGameStateChanges[`${GAME_NAME}DenomForRespin`] = denom;
        userGameStateChanges[`${GAME_NAME}BetLevelForRespin`] = betLevel;
    }

    if (!isFreeSpin && !isRespin && !triggerRespin && scatterCount >= 3) {
        const fsCounts = gameConfig.settings?.slotFreeCount || [0,0,0,10,15,20];
        freeSpinsAwardedThisSpin = fsCounts[Math.min(scatterCount, fsCounts.length - 1)] || 0;
        if (freeSpinsAwardedThisSpin > 0) {
            userGameStateChanges[`${GAME_NAME}FreeGames`] = freeSpinsAwardedThisSpin;
            currentFsTotal = freeSpinsAwardedThisSpin;
            userGameStateChanges[`${GAME_NAME}CurrentFreeGame`] = 0; currentFsPlayed = 0;
            userGameStateChanges[`${GAME_NAME}BonusWin`] = 0; currentBonusWin = 0;
            userGameStateChanges[`${GAME_NAME}MonsterHealth`] = 0; // Reset monster health on new FS trigger
            userGameStateChanges[`${GAME_NAME}StickyWilds`] = []; // Clear stickies on new FS trigger
            userGameStateChanges[`${GAME_NAME}Level3FSAwarded`] = false;
            userGameStateChanges[`${GAME_NAME}FreeSpinsActive`] = true;
            userGameStateChanges[`${GAME_NAME}DenomForFS`] = denom;
            userGameStateChanges[`${GAME_NAME}BetLevelForFS`] = betLevel;
        }
    }

    if (isFreeSpin) {
        currentFsPlayed = (currentUserGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0) + 1;
        userGameStateChanges[`${GAME_NAME}CurrentFreeGame`] = currentFsPlayed;
        currentBonusWin = (currentUserGameState[`${GAME_NAME}BonusWin`] ?? 0) + totalWinCoins;
        userGameStateChanges[`${GAME_NAME}BonusWin`] = currentBonusWin;
        if (additionalFsAwarded > 0) currentFsTotal += additionalFsAwarded; // Already saved to UGSChanges

        if (currentFsPlayed >= currentFsTotal) {
            nextAction = "spin"; gameIsOver = true; userGameStateChanges[`${GAME_NAME}FreeSpinsActive`] = false;
            // Reset FS specific states
             userGameStateChanges[`${GAME_NAME}StickyWilds`] = [];
             userGameStateChanges[`${GAME_NAME}MonsterHealth`] = 0;
             userGameStateChanges[`${GAME_NAME}Level3FSAwarded`] = false;
        } else {
            nextAction = "freespin"; gameIsOver = false;
        }
    } else if (isRespin) {
        if (triggerRespin) {
            nextAction = "respin"; gameIsOver = false;
        } else {
            nextAction = "spin"; gameIsOver = true; userGameStateChanges[`${GAME_NAME}IsRespinActive`] = false; userGameStateChanges[`${GAME_NAME}StickyWilds`] = [];
        }
    } else if (triggerRespin) {
        nextAction = "respin"; gameIsOver = false;
    } else if (freeSpinsAwardedThisSpin > 0) {
        nextAction = "freespin"; gameIsOver = false;
    }

    return {
        userGameStateChanges,
        generatedReelsForResponse: { symbols: reelsForWinCalc, positions: generatedReels.positions },
        totalWinCoins,
        lineWinsArray,
        scatterCount,
        nextAction,
        gameIsOver,
        currentStickyWildsResult: userGameStateChanges[`${GAME_NAME}StickyWilds`] || [], // Use the final sticky state
        monsterHealthResult: userGameStateChanges[`${GAME_NAME}MonsterHealth`] ?? monsterHealth,
        featureStageResult: Math.floor((userGameStateChanges[`${GAME_NAME}MonsterHealth`] ?? monsterHealth) / 3),
        freeSpinsAwardedThisSpinResult: freeSpinsAwardedThisSpin,
        freeSpinsLeftResult: Math.max(0, currentFsTotal - currentFsPlayed),
        freeSpinsTotalResult: currentFsTotal,
        currentFreeGameResult: currentFsPlayed,
        bonusWinCoinsResult: currentBonusWin,
        expansionDidOccur: false, // CFTBL spreading wilds are part of normal win calc, not separate "expansion pay"
        expandedSymbolId: null,
        expandedWinCoins: 0,
    };
}

const handleInit = async (c: Context) => {
  const jwtPayload = c.get('user');
  const userIdString = jwtPayload?.sub;

  if (!userIdString) {
    return c.json({ error: 'User ID not found in token' }, 401);
  }
  const userId = parseInt(userIdString, 10);

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID format in token' }, 400);
  }

  const sessid = c.req.query('sessid');
  console.log(`[${GAME_NAME}] Init action called for user ${userId}, client session ${sessid}`);
  // console.log(`[${GAME_NAME}] All Query Params:`, c.req.query()); // Too verbose for regular logs

  try {
    const user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (!gameConfig) return c.json({ error: `Game configuration not found for ${GAME_NAME}` }, 500);

    let userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);

    const currentDenom = userGameState[`${GAME_NAME}Denom`] ?? gameConfig.settings?.Denominations?.[0] ?? gameConfig.denomination ?? 0.01;
    const currentBetLevel = userGameState[`${GAME_NAME}BetLevel`] ?? gameConfig.settings?.bet_levels?.[0] ?? 1;

    if (userGameState[`${GAME_NAME}Denom`] === undefined) {
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}Denom`, currentDenom);
         userGameState[`${GAME_NAME}Denom`] = currentDenom; // Update local copy
    }
    if (userGameState[`${GAME_NAME}BetLevel`] === undefined) {
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}BetLevel`, currentBetLevel);
        userGameState[`${GAME_NAME}BetLevel`] = currentBetLevel; // Update local copy
    }

    const activeRespin = userGameState[`${GAME_NAME}IsRespinActive`] === true;
    const activeFreeSpins = userGameState[`${GAME_NAME}FreeSpinsActive`] === true &&
                           (userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0) < (userGameState[`${GAME_NAME}FreeGames`] ?? 0);

    if (!activeRespin && !activeFreeSpins) {
        const initialStatesToSet = {
            [`${GAME_NAME}BonusWin`]: 0,
            [`${GAME_NAME}FreeGames`]: 0,
            [`${GAME_NAME}CurrentFreeGame`]: 0,
            [`${GAME_NAME}TotalWin`]: 0, // This might be overall session total win, not just feature.
            [`${GAME_NAME}MonsterHealth`]: 0,
            [`${GAME_NAME}StickyWilds`]: [],
            [`${GAME_NAME}Level3FSAwarded`]: false,
        };
        for(const key in initialStatesToSet) {
            await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, initialStatesToSet[key as keyof typeof initialStatesToSet]);
            userGameState[key] = initialStatesToSet[key as keyof typeof initialStatesToSet];
        }
    }

    const responseObject: Record<string, any> = {
        clientaction: 'init',
        playercurrencyiso: user.currency || gameConfig.settings?.playercurrencyiso || 'EUR',
        jackpotcurrencyiso: user.currency || gameConfig.settings?.jackpotcurrencyiso || 'EUR',
        credit: Math.round((user.balance ?? 0) * 100),
        game_win_cents: 0, game_win_coins: 0, totalwin_cents: 0, totalwin_coins: 0,
        denomination_all: (gameConfig.settings?.Denominations || [0.01,0.02,0.05,0.10,0.20]).map(d => d*100).join('%2C'),
        betlevel_all: (gameConfig.settings?.bet_levels || [1,2,3,4,5,10]).join('%2C'),
        bet_denomination: currentDenom * 100,
        denomination_standard: currentDenom * 100,
        bet_betlevel: currentBetLevel,
        bet_lines: gameConfig.settings?.lines ?? 20,
        casinoID: gameConfig.settings?.casinoID || "netent",
        gameServerVersion: gameConfig.settings?.gameServerVersion || "1.5.0",
        staticsharedurl: gameConfig.settings?.staticsharedurl || "https://static.casinomodule.com/shared/",
        gamesoundurl: gameConfig.settings?.gamesoundurl || `https://static.casinomodule.com/games/netent/${GAME_NAME.toLowerCase()}/`,
        historybutton: "false", fullscreenallowed: "true", autoplayallowed: "true",
        autoplaydefault: gameConfig.settings?.autoplaydefault || 10,
        flashvars_gameRulesUrl: gameConfig.settings?.gameRulesUrl || `/rules/${GAME_NAME}/rules_en.html`,
        flashvars_helpUrl: gameConfig.settings?.helpUrl || `/rules/${GAME_NAME}/rules_en.html`,
        flashvars_lang: "en", label: gameConfig.title || GAME_NAME, gametitle: gameConfig.title || GAME_NAME,
        playforfun: "false", multiplier: "1", betlinesconfig: "1", betlevelconfig: "1",
        coinconfig: (currentDenom*100).toString(), creditschosentype: "coin", currencydecimaldigits: "2",
        currencyprefix: "", currencysuffix: user.currency || "EUR", currencyspace: "true",
        currencythousandseparator: ",", maxbet: gameConfig.settings?.maxBet || "100.00",
        minbet: gameConfig.settings?.minBet || "0.20", nearwinallowed: "false",
        slotTheme: gameConfig.settings?.slotTheme || "underwater",
        softwareversion: gameConfig.settings?.softwareversion || "2.10.6",
        theme: gameConfig.settings?.theme || "generic",
        volatility: gameConfig.settings?.volatility || "5",
        wavecount: userGameState[`${GAME_NAME}MonsterHealth`] || 0,
        collectablesWon: userGameState[`${GAME_NAME}MonsterHealth`] || 0,
        feature_stage: `stage${Math.floor((userGameState[`${GAME_NAME}MonsterHealth`] || 0) / 3)}`,
        ...PAYLINES.reduce((acc, lineCoords, index) => {
            acc[`bl.i${index}.line`] = lineCoords.join('%2C');
            acc[`bl.i${index}.id`] = index.toString();
            return acc;
        }, {} as Record<string, string>),
        "bl.standard": PAYLINES.map((_, i) => i).join('%2C'),
    };

    const currentMonsterHealthInit = userGameState[`${GAME_NAME}MonsterHealth`] ?? 0;
    const freeSpinsTotalInit = userGameState[`${GAME_NAME}FreeGames`] ?? 0;
    const freeSpinsPlayedInit = userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0;

    if (activeFreeSpins) {
        responseObject.restore = "true";
        responseObject.gamestate_current = `freespinlevel${Math.floor(currentMonsterHealthInit / 3)}`;
        responseObject.nextaction = "freespin"; responseObject.gameover = "false";
        responseObject.freespins_initial = freeSpinsTotalInit;
        responseObject.freespins_total = freeSpinsTotalInit;
        responseObject.freespins_left = freeSpinsTotalInit - freeSpinsPlayedInit;
        responseObject.freespins_multiplier = 1;
        const fsTotalWinCoins = userGameState[`${GAME_NAME}BonusWin`] ?? 0;
        responseObject.freespins_totalwin_coins = fsTotalWinCoins;
        responseObject.freespins_totalwin_cents = Math.round(fsTotalWinCoins * currentDenom * 100);
        responseObject.totalwin_coins = fsTotalWinCoins;
        responseObject.totalwin_cents = Math.round(fsTotalWinCoins * currentDenom * 100);

        const savedReelsRaw = userGameState[`${GAME_NAME}Reels`];
        const savedReels = savedReelsRaw?.symbols ? savedReelsRaw : {symbols: null, positions: null};
        const stickyWildsInit = userGameState[`${GAME_NAME}StickyWilds`] || [];

        for (let i = 0; i < 5; i++) {
            const symbols = savedReels.symbols?.[i] || (gameConfig.reel_strips[`reelStrip${i+1}`] || []).slice(0,3);
            const position = savedReels.positions?.[i] || 0;
            responseObject[`rs.i0.r.i${i}.syms`] = symbols.join('%2C');
            responseObject[`rs.i0.r.i${i}.pos`] = position.toString();
            let overlayIdx = 0;
            stickyWildsInit.filter((sw: any) => sw.reel === i).forEach((swPos: any) => {
                responseObject[`rs.i0.r.i${i}.overlay.i${overlayIdx}.with`] = WILD_SYMBOL_CFTBL;
                responseObject[`rs.i0.r.i${i}.overlay.i${overlayIdx}.row`] = swPos.row.toString();
                overlayIdx++;
            });
        }
        responseObject["rs.i0.id"] = `freespinlevel${Math.floor(currentMonsterHealthInit / 3)}`;


    } else if (activeRespin) {
        responseObject.restore = "true";
        responseObject.gamestate_current = "basicrespin";
        responseObject.nextaction = "respin"; responseObject.gameover = "false";
        const savedReelsRaw = userGameState[`${GAME_NAME}Reels`];
        const savedReels = savedReelsRaw?.symbols ? savedReelsRaw : {symbols: null, positions: null};
        const stickyWildsInit = userGameState[`${GAME_NAME}StickyWilds`] || [];
         for (let i = 0; i < 5; i++) {
            const symbols = savedReels.symbols?.[i] || (gameConfig.reel_strips[`reelStrip${i+1}`] || []).slice(0,3);
            const position = savedReels.positions?.[i] || 0;
            responseObject[`rs.i0.r.i${i}.syms`] = symbols.join('%2C');
            responseObject[`rs.i0.r.i${i}.pos`] = position.toString();
            let overlayIdx = 0;
            stickyWildsInit.filter((sw: any) => sw.reel === i).forEach((swPos: any) => {
                responseObject[`rs.i0.r.i${i}.overlay.i${overlayIdx}.with`] = WILD_SYMBOL_CFTBL;
                responseObject[`rs.i0.r.i${i}.overlay.i${overlayIdx}.row`] = swPos.row.toString();
                overlayIdx++;
            });
        }
        responseObject["rs.i0.id"] = "basicrespin";


    } else {
        responseObject.restore = "false";
        responseObject.gamestate_current = "basic";
        responseObject.nextaction = "spin";
        responseObject.gameover = "true";
        for (let i = 0; i < 5; i++) {
            const reelStripKey = `reelStrip${i + 1}`;
            const strip = gameConfig.reel_strips[reelStripKey] || ['SYM_0', 'SYM_0', 'SYM_0'];
            const pos = Math.floor(Math.random() * Math.max(1, strip.length - 2));
            const syms = [strip[pos] || 'SYM_0', strip[pos + 1] || 'SYM_0', strip[pos + 2] || 'SYM_0'];
            responseObject[`rs.i0.r.i${i}.syms`] = syms.join('%2C');
            responseObject[`rs.i0.r.i${i}.pos`] = pos.toString();
        }
        responseObject["rs.i0.id"] = "basic";
    }

    responseObject._message = "Init action substantially refined with static params, better fresh reels, and full state restoration logic.";
    // TODO: Log this init event if game analytics require it.
    // LogService.logGameSpin({ userId, gameId: gameConfig.id, gameName: GAME_NAME, responseData: JSON.stringify(responseObject), betAmount: 0, winAmount: 0, userBalanceAfterSpin: user.balance ?? 0 });

    return c.json(responseObject);

  } catch (error: any) {
    console.error(`[${GAME_NAME}] Error in handleInit:`, error);
    return c.json({ error: 'Internal server error', details: error.message }, 500);
  }
};

const handleSpin = async (c: Context) => {
  const jwtPayload = c.get('user');
  const userIdString = jwtPayload?.sub;
  if (!userIdString) return c.json({ error: 'User ID not found in token' }, 401);
  const userId = parseInt(userIdString, 10);
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID format' }, 400);

  const queryParams = c.req.query();
  const betDenominationCent = parseInt(queryParams['bet_denomination'] || '0');
  const betLevel = parseInt(queryParams['bet_betlevel'] || '1');
  const denom = betDenominationCent / 100;
  const lines = PAYLINES.length; // Fixed lines for this game
  const totalBetAmountCurrency = denom * betLevel * lines;

  console.log(`[${GAME_NAME}] Spin: user ${userId}, denom ${denom}, level ${betLevel}, totalBet ${totalBetAmountCurrency}`);

  try {
    let user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);
    if (!user || !gameConfig) return c.json({ error: 'User or game config not found' }, 500);

    if ((user.balance ?? 0) < totalBetAmountCurrency) {
      return c.json({ error: 'Insufficient balance', event: 'error', type: 'spin', serverResponse: 'invalid balance' }, 400);
    }

    const balanceUpdateArgs: UpdateUserBalanceArgs = { userId, amount: -totalBetAmountCurrency, transactionType: 'spin_bet', systemName: GAME_NAME };
    const updatedUser = await UserService.updateUserBalance(balanceUpdateArgs);
    if (!updatedUser) return c.json({ error: 'Failed to update balance for bet' }, 500);
    user = updatedUser;

    const shopId = user.shop_id;
    const gameBankType = gameConfig.gamebank || 'slots';
    const betContributionRate = parseFloat(gameConfig.settings?.bet_contribution_rate_slots || '0.9'); // Example: 90% default
    let amountToBank = 0;
    if (shopId && totalBetAmountCurrency > 0) {
      amountToBank = totalBetAmountCurrency * betContributionRate;
      await BankService.updateBank(shopId, gameBankType, amountToBank);
    }

    let userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);
    // Save current bet config for potential FS trigger or respins
    userGameState[`${GAME_NAME}Denom`] = denom;
    userGameState[`${GAME_NAME}BetLevel`] = betLevel;
    // Persist these immediately in case spin triggers a feature that needs them
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}Denom`, denom);
    await UserGameStateService.updateUserGameState(userId, gameConfig.id, `${GAME_NAME}BetLevel`, betLevel);


    const spinResult = await _performSpinLogic(userId, gameConfig, userGameState, betLevel, denom, false, false);

    let finalUser = user;
    if (spinResult.totalWinCoins > 0) {
        const totalWinCurrency = spinResult.totalWinCoins * denom;
        const winUpdateArgs: UpdateUserBalanceArgs = { userId, amount: totalWinCurrency, transactionType: 'spin_win', systemName: GAME_NAME };
        const userAfterWin = await UserService.updateUserBalance(winUpdateArgs);
        if (userAfterWin) finalUser = userAfterWin;
    }

    for (const key in spinResult.userGameStateChanges) {
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, spinResult.userGameStateChanges[key]);
    }
    userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id); // Refresh after all updates

    // Construct Spin Response
    const responseObject = {
        clientaction: "spin",
        credit: Math.round((finalUser.balance ?? 0) * 100),
        gameover: spinResult.gameIsOver.toString(),
        nextaction: spinResult.nextAction,
        gamestate_current: spinResult.nextAction === 'respin' ? 'basicrespin' : (spinResult.nextAction === 'freespin' ? `freespinlevel${spinResult.featureStageResult}` : 'basic'),
        bet_denomination: denom * 100, bet_betlevel: betLevel, bet_lines: lines,
        "rs.i0.id": spinResult.nextAction === 'respin' ? 'basicrespin' : (spinResult.nextAction === 'freespin' ? `freespinlevel${spinResult.featureStageResult}` : 'basic'),
        ...(() => {
            const reelData: Record<string, string> = {};
            for (let r = 0; r < 5; r++) {
                reelData[`rs.i0.r.i${r}.syms`] = spinResult.generatedReelsForResponse.symbols[r].join('%2C');
                reelData[`rs.i0.r.i${r}.pos`] = spinResult.generatedReelsForResponse.positions[r].toString();
            }
            return reelData;
        })(),
        ...(() => {
            const overlayData: Record<string, string> = {}; let i = 0;
            spinResult.currentStickyWildsResult.forEach(sw => {
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.with`] = sw.symbol;
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.row`] = sw.row.toString();
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.pos`] = spinResult.generatedReelsForResponse.positions[sw.reel].toString(); // Use reel stop pos for overlay pos
                i++;
            });
            return overlayData;
        })(),
        ...(spinResult.totalWinCoins > 0 ? {
            ...spinResult.lineWinsArray.reduce((acc, lw, idx) => {
                acc[`ws.i${idx}.reelset`] = "basic"; // Or gamestate_current if it reflects reelset ID
                acc[`ws.i${idx}.types.i0.coins`] = lw.winCoins.toString();
                acc[`ws.i${idx}.types.i0.cents`] = Math.round(lw.winCoins * denom * 100).toString();
                lw.positions.forEach((p: {col: number, row: number}, pIdx: number) => { acc[`ws.i${idx}.pos.i${pIdx}`] = `${p.col}%2C${p.row}`; });
                acc[`ws.i${idx}.betline`] = lw.lineIndex.toString();
                acc[`ws.i${idx}.sym`] = lw.symbol;
                acc[`ws.i${idx}.direction`] = "left_to_right";
                acc[`ws.i${idx}.numsymbols`] = lw.numSymbols.toString();
                return acc;
            }, {} as Record<string, string>),
        } : {}),
        game_win_cents: Math.round(spinResult.totalWinCoins * denom * 100),
        game_win_coins: spinResult.totalWinCoins,
        totalwin_cents: Math.round(spinResult.totalWinCoins * denom * 100),
        totalwin_coins: spinResult.totalWinCoins,
        wavecount: spinResult.monsterHealthResult, collectablesWon: spinResult.monsterHealthResult, feature_stage: `stage${spinResult.featureStageResult}`,
        ...(spinResult.freeSpinsAwardedThisSpinResult > 0 ? {
            freespins_initial: spinResult.freeSpinsAwardedThisSpinResult,
            freespins_total: spinResult.freeSpinsAwardedThisSpinResult,
            freespins_left: spinResult.freeSpinsAwardedThisSpinResult,
            freespins_multiplier: 1,
            freespins_totalwin_coins:0, freespins_totalwin_cents:0,
        } : {}),
         roundid: `round-${Date.now()}`, actionid: `action-${Date.now()}`,
         multiplier: "1", nearwinallowed: "false", // Common static fields
         _message: "Spin action refined response.",
    };

    const profitFromBet = totalBetAmountCurrency - (spinResult.totalWinCoins * denom) - amountToBank;
    const spinLogData: Partial<GameSpinLogData> = {
        userId, gameId: gameConfig.id, gameName: GAME_NAME, shopId: user.shop_id ?? undefined,
        responseData: JSON.stringify(responseObject), betAmount: totalBetAmountCurrency, winAmount: spinResult.totalWinCoins * denom,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('remote-addr'),
        userBalanceAfterSpin: finalUser.balance ?? 0, denomination: denom,
        toGameBanks: amountToBank,
        betProfit: profitFromBet,
    };
    await LogService.logGameSpin(spinLogData as GameSpinLogData);
    return c.json(responseObject);

  } catch (error: any) {
    console.error(`[${GAME_NAME}] Error in handleSpin:`, error);
    return c.json({ error: 'Internal server error', details: error.message }, 500);
  }
};

const handleFreeSpin = async (c: Context) => {
  const jwtPayload = c.get('user');
  const userIdString = jwtPayload?.sub;
  if (!userIdString) return c.json({ error: 'User ID not found in token' }, 401);
  const userId = parseInt(userIdString, 10);
  if (isNaN(userId)) return c.json({ error: 'Invalid user ID format' }, 400);

  console.log(`[${GAME_NAME}] FreeSpin action called for user ${userId}`);

  try {
    let user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);
    if (!user || !gameConfig) return c.json({ error: 'User or game config not found' }, 500);

    let userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);

    const currentFreeGamesTotal = userGameState[`${GAME_NAME}FreeGames`] ?? 0;
    let currentFreeGameNum = userGameState[`${GAME_NAME}CurrentFreeGame`] ?? 0;

    if (!(userGameState[`${GAME_NAME}FreeSpinsActive`]) || currentFreeGameNum >= currentFreeGamesTotal) {
      const changes: Record<string,any> = {
        [`${GAME_NAME}FreeGames`]:0, [`${GAME_NAME}CurrentFreeGame`]:0, [`${GAME_NAME}StickyWilds`]:[],
        [`${GAME_NAME}MonsterHealth`]:0, [`${GAME_NAME}FreeSpinsActive`]: false, [`${GAME_NAME}Level3FSAwarded`]: false
      };
      for(const key in changes) await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, changes[key]);
      return c.json({ error: 'No free spins left or invalid state.', nextaction: 'spin', gameover: 'true' });
    }

    const denom = userGameState[`${GAME_NAME}DenomForFS`] ?? userGameState[`${GAME_NAME}Denom`] ?? (gameConfig.settings?.Denominations?.[0] ?? gameConfig.denomination ?? 0.01);
    const betLevel = userGameState[`${GAME_NAME}BetLevelForFS`] ?? userGameState[`${GAME_NAME}BetLevel`] ?? (gameConfig.settings?.bet_levels?.[0] ?? 1);

    const spinResult = await _performSpinLogic(userId, gameConfig, userGameState, betLevel, denom, true, false);

    let finalUser = user;
    if (spinResult.totalWinCoins > 0) {
        const totalWinCurrency = spinResult.totalWinCoins * denom;
        const winUpdateArgs: UpdateUserBalanceArgs = { userId, amount: totalWinCurrency, transactionType: 'freespin_win', systemName: GAME_NAME+"_FS" };
        const userAfterWin = await UserService.updateUserBalance(winUpdateArgs);
        if (userAfterWin) finalUser = userAfterWin;
    }

    for (const key in spinResult.userGameStateChanges) {
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, spinResult.userGameStateChanges[key]);
    }
    userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id); // Refresh after all updates

    const responseObject = {
        clientaction: "freespin",
        credit: Math.round((finalUser.balance ?? 0) * 100),
        gameover: spinResult.gameIsOver.toString(),
        nextaction: spinResult.nextAction,
        gamestate_current: `freespinlevel${spinResult.featureStageResult}`,
        "rs.i0.id": `freespinlevel${spinResult.featureStageResult}`, // Reelset ID for free spins
        bet_denomination: denom * 100, bet_betlevel: betLevel, bet_lines: PAYLINES.length,
         ...(() => {
            const reelData: Record<string, string> = {};
            for (let r = 0; r < 5; r++) {
                reelData[`rs.i0.r.i${r}.syms`] = spinResult.generatedReelsForResponse.symbols[r].join('%2C');
                reelData[`rs.i0.r.i${r}.pos`] = spinResult.generatedReelsForResponse.positions[r].toString();
            }
            return reelData;
        })(),
        ...(() => {
            const overlayData: Record<string, string> = {}; let i = 0;
            spinResult.currentStickyWildsResult.forEach(sw => {
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.with`] = sw.symbol;
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.row`] = sw.row.toString();
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.pos`] = spinResult.generatedReelsForResponse.positions[sw.reel].toString();
                i++;
            });
            return overlayData;
        })(),
        ...(spinResult.totalWinCoins > 0 ? {
            ...spinResult.lineWinsArray.reduce((acc, lw, idx) => {
                acc[`ws.i${idx}.reelset`] = `freespinlevel${spinResult.featureStageResult}`;
                acc[`ws.i${idx}.types.i0.coins`] = lw.winCoins.toString();
                acc[`ws.i${idx}.types.i0.cents`] = Math.round(lw.winCoins * denom * 100).toString();
                lw.positions.forEach((p: {reel: number, row: number}, pIdx: number) => { acc[`ws.i${idx}.pos.i${pIdx}`] = `${p.reel}%2C${p.row}`; });
                acc[`ws.i${idx}.betline`] = lw.lineId.toString();
                acc[`ws.i${idx}.sym`] = lw.symbol;
                acc[`ws.i${idx}.direction`] = "left_to_right";
                acc[`ws.i${idx}.numsymbols`] = lw.count.toString();
                return acc;
            }, {} as Record<string, string>),
        } : {}),
        game_win_cents: Math.round(spinResult.totalWinCoins * denom * 100),
        game_win_coins: spinResult.totalWinCoins,
        totalwin_cents: Math.round(spinResult.bonusWinCoinsResult * denom * 100), // In FS, totalwin is accumulated bonus win
        totalwin_coins: spinResult.bonusWinCoinsResult,
        freespins_initial: spinResult.freeSpinsTotalResult,
        freespins_total: spinResult.freeSpinsTotalResult,
        freespins_left: spinResult.freeSpinsLeftResult,
        freespins_multiplier: 1,
        freespins_totalwin_coins: spinResult.bonusWinCoinsResult,
        freespins_totalwin_cents: Math.round(spinResult.bonusWinCoinsResult * denom * 100),
        collectablesWon: spinResult.monsterHealthResult, wavecount: spinResult.monsterHealthResult, feature_stage: `stage${spinResult.featureStageResult}`,
        roundid: `round-${Date.now()}`, actionid: `action-${Date.now()}`,
         _message: "FreeSpin action refined response.",
    };

    const spinLogData: Partial<GameSpinLogData> = {
        userId, gameId: gameConfig.id, gameName: GAME_NAME, shopId: user.shop_id ?? undefined,
        responseData: JSON.stringify(responseObject), betAmount: 0, winAmount: spinResult.totalWinCoins * denom,
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('remote-addr'),
        userBalanceAfterSpin: finalUser.balance ?? 0, denomination: denom,
    };
    await LogService.logGameSpin(spinLogData as GameSpinLogData);
    return c.json(responseObject);

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

  console.log(`[${GAME_NAME}] Respin action called for user ${userId}`);

  try {
    let user = await UserService.getUserById(userId);
    const gameConfig = await GameConfigService.getGameConfigByName(GAME_NAME);
    if (!user || !gameConfig) return c.json({ error: 'User or game config not found' }, 500);

    let userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id);

    if (!(userGameState[`${GAME_NAME}IsRespinActive`]) || !(userGameState[`${GAME_NAME}StickyWilds`]?.length > 0)) {
        const changes: Record<string,any> = { [`${GAME_NAME}IsRespinActive`]:false, [`${GAME_NAME}StickyWilds`]:[] };
        for(const key in changes) await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, changes[key]);
        return c.json({ error: 'No active respin state found.', nextaction: 'spin', gameover: 'true' });
    }

    const denom = userGameState[`${GAME_NAME}DenomForRespin`] ?? (gameConfig.settings?.Denominations?.[0] ?? gameConfig.denomination ?? 0.01);
    const betLevel = userGameState[`${GAME_NAME}BetLevelForRespin`] ?? (gameConfig.settings?.bet_levels?.[0] ?? 1);

    const spinResult = await _performSpinLogic(userId, gameConfig, userGameState, betLevel, denom, false, true);

    let finalUser = user;
    if (spinResult.totalWinCoins > 0) {
        const totalWinCurrency = spinResult.totalWinCoins * denom;
        const winUpdateArgs: UpdateUserBalanceArgs = { userId, amount: totalWinCurrency, transactionType: 'respin_win', systemName: GAME_NAME+"_RS" };
        const userAfterWin = await UserService.updateUserBalance(winUpdateArgs);
        if (userAfterWin) finalUser = userAfterWin;
    }

    for (const key in spinResult.userGameStateChanges) {
        await UserGameStateService.updateUserGameState(userId, gameConfig.id, key, spinResult.userGameStateChanges[key]);
    }
     userGameState = await UserGameStateService.getUserGameState(userId, gameConfig.id); // Refresh

    const responseObject = {
        clientaction: "respin",
        credit: Math.round((finalUser.balance ?? 0) * 100),
        gameover: spinResult.gameIsOver.toString(),
        nextaction: spinResult.nextAction,
        gamestate_current: spinResult.nextAction === 'respin' ? "basicrespin" : "basic",
        "rs.i0.id": spinResult.nextAction === 'respin' ? "basicrespin" : "basic",
         ...(() => {
            const reelData: Record<string, string> = {};
            for (let r = 0; r < 5; r++) {
                reelData[`rs.i0.r.i${r}.syms`] = spinResult.generatedReelsForResponse.symbols[r].join('%2C');
                reelData[`rs.i0.r.i${r}.pos`] = spinResult.generatedReelsForResponse.positions[r].toString();
            }
            return reelData;
        })(),
        ...(() => {
            const overlayData: Record<string, string> = {}; let i = 0;
            spinResult.currentStickyWildsResult.forEach(sw => {
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.with`] = sw.symbol;
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.row`] = sw.row.toString();
                overlayData[`rs.i0.r.${sw.reel}.overlay.i${i}.pos`] = spinResult.generatedReelsForResponse.positions[sw.reel].toString();
                i++;
            });
            return overlayData;
        })(),
         ...(spinResult.totalWinCoins > 0 ? {
            ...spinResult.lineWinsArray.reduce((acc, lw, idx) => {
                acc[`ws.i${idx}.reelset`] = "basicrespin";
                acc[`ws.i${idx}.types.i0.coins`] = lw.winCoins.toString();
                acc[`ws.i${idx}.types.i0.cents`] = Math.round(lw.winCoins * denom * 100).toString();
                lw.positions.forEach((p: {reel: number, row: number}, pIdx: number) => { acc[`ws.i${idx}.pos.i${pIdx}`] = `${p.reel}%2C${p.row}`; });
                acc[`ws.i${idx}.betline`] = lw.lineId.toString();
                acc[`ws.i${idx}.sym`] = lw.symbol;
                acc[`ws.i${idx}.direction`] = "left_to_right";
                acc[`ws.i${idx}.numsymbols`] = lw.count.toString();
                return acc;
            }, {} as Record<string, string>),
        } : {}),
        game_win_cents: Math.round(spinResult.totalWinCoins * denom * 100),
        game_win_coins: spinResult.totalWinCoins,
        totalwin_cents: Math.round(spinResult.totalWinCoins * denom * 100), // Respins are part of the same bet round
        totalwin_coins: spinResult.totalWinCoins,
        roundid: `round-${Date.now()}`, actionid: `action-${Date.now()}`,
         _message: "Respin action refined response.",
    };

    const spinLogData: Partial<GameSpinLogData> = {
        userId, gameId: gameConfig.id, gameName: GAME_NAME, shopId: user.shop_id ?? undefined,
        responseData: JSON.stringify(responseObject), betAmount: 0, winAmount: spinResult.totalWinCoins * denom, // Respins are free
        ipAddress: c.req.header('x-forwarded-for') || c.req.header('remote-addr'),
        userBalanceAfterSpin: finalUser.balance ?? 0, denomination: denom,
    };
    await LogService.logGameSpin(spinLogData as GameSpinLogData);
    return c.json(responseObject);

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
