import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { GameConfigService } from '../services/gameConfigService';
import { UserService } from '../services/userService';
import { BankService } from '../services/bankService';
import { LogService } from '../services/logService';
import { SlotSettingsService, SpinResultDetails, LineWin, ScatterOutcome } from '../services/slotSettingsService';
import { mockAuth } from './mockAuth';
import { PrismaClient, GamePaytableEntry, Prisma } from '../generated/prisma';

const narcosNetApp = new Hono();
const prisma = new PrismaClient();

const gameConfigService = new GameConfigService(prisma);
const userService = new UserService(prisma);
const bankService = new BankService(prisma);
const logService = new LogService(prisma);

const GAME_NAME = 'NarcosNET';

narcosNetApp.use('*', mockAuth);

narcosNetApp.get('/server', async (c) => {
  const userId = c.get('userId') as number;
  const playerIp = c.get('playerIp') as string;
  const query = c.req.query();
  const action = query['action'];

  let gameIdToUse: number;

  try {
    const gameDetails = await gameConfigService.getGameDetailsByName(GAME_NAME);
    if (!gameDetails || gameDetails.id === undefined) {
        throw new HTTPException(404, { message: `Game ${GAME_NAME} not found or has no ID` });
    }
    gameIdToUse = gameDetails.id;

    const slotSettingsService = new SlotSettingsService(
        gameIdToUse, userId, gameConfigService, userService, bankService, logService
    );
    // Initialization is called within executeSpin if needed, or can be called here once
    // await slotSettingsService.initialize(); // Initializing here might be better if settings are needed before executeSpin

    let responseString = '';
    const params = new URLSearchParams();

    switch (action) {
      case 'init':
      case 'reloadbalance':
        await slotSettingsService.initialize(); // Ensure initialized for these helpers
        const balanceInGameCurrency = await slotSettingsService.getBalanceInGameCurrency();
        const denominations = slotSettingsService.getDenominations();
        const betLevels = slotSettingsService.getBetLevels();
        const lastReels = await slotSettingsService.getLastReelsState();
        const currentGamestate = await slotSettingsService.getCurrentGamestate();
        const currentDenom = slotSettingsService.getCurrentDenom();
        const baseUnitMultiplier = 1 / currentDenom;

        params.append('credit', Math.round(balanceInGameCurrency * baseUnitMultiplier).toString());
        params.append('denomination.all', denominations.map(d => Math.round(d * baseUnitMultiplier)).join(','));
        params.append('betlevel.all', betLevels.join(','));
        params.append('gamestate.current', currentGamestate);
        params.append('gamestate.stack', currentGamestate); // Simplified, real stack might be more complex
        params.append('game.win.amount', '0');
        params.append('totalwin.cents', '0');
        params.append('nextaction', currentGamestate === 'freespin' ? 'freespin' : (currentGamestate === 'respin' ? 'respin' : 'spin'));
        params.append('gameover', currentGamestate === 'basic' ? 'true' : 'false');
        params.append('clientaction', 'init');
        params.append('wavecount', '1');
        params.append('multiplier', '1');
        params.append('nearwinallowed', 'true');
        params.append('next.rs', currentGamestate === 'basic' ? 'basic' : currentGamestate); // rs for reelset

        Object.entries(lastReels.reels).forEach(([reelKey, symbols], index) => {
            const reelNum = parseInt(reelKey.replace('reel', '')) -1; // Assuming reelKey is "reel1", "reel2"
            params.append(`rs.i0.r.i${reelNum}.syms`, (symbols as string[]).join(','));
            // rs.i0.r.iX.pos might be needed if specific stop positions are used vs just symbols
        });

        // Free spin related state if initializing into free spins
        if(currentGamestate === 'freespin') {
            const fsState = await userService.getUserGameState(userId, gameIdToUse, 'freeSpinsRemaining');
            const fsTotal = await userService.getUserGameState(userId, gameIdToUse, 'freeSpinsAwarded');
            const fsTotalWin = await userService.getUserGameState(userId, gameIdToUse, 'freeSpinsTotalWinBaseUnits');
            const fsBetDenom = await userService.getUserGameState(userId, gameIdToUse, 'currentDenom'); // Denom used for FS
            const fsBetLevel = await userService.getUserGameState(userId, gameIdToUse, 'freeSpinBetLevel'); // Assuming bet level is stored

            params.append('freeround.betlevel', (fsBetLevel || betLevels[0]).toString());
            params.append('freeround.denomination', fsBetDenom ? Math.round((fsBetDenom as number) * baseUnitMultiplier).toString() : Math.round(currentDenom * baseUnitMultiplier).toString());
            params.append('freeround.total', (fsTotal || 0).toString());
            params.append('freeround.current', ((fsTotal || 0) - (fsState || 0)).toString());
            params.append('freeround.totalwin.cents', (fsTotalWin || 0).toString());
        }

        responseString = params.toString();
        break;

      case 'spin':
      case 'freespin':
      case 'respin': // Note: 'respin' for LockedUp will need very specific handling
        const betLevelStr = query['betlevel'] || query['bet_betlevel'];
        const betDenomStr = query['denomination'] || query['bet_denomination'];

        // Initialize to get currentDenom if not set by player, or to validate player choice
        await slotSettingsService.initialize();
        let currentDenomForSpin = slotSettingsService.getCurrentDenom();

        if (betDenomStr && action === 'spin') { // Denomination change typically only allowed on 'bet' action
             try {
                await slotSettingsService.setCurrentDenom(parseFloat(betDenomStr));
                currentDenomForSpin = parseFloat(betDenomStr);
             } catch (e) {
                 // Keep existing denom if provided one is invalid
                 console.warn("Invalid denomination provided by client, using current:", betDenomStr);
             }
        }
        const spinBaseUnitMultiplier = 1 / currentDenomForSpin;

        const betLevel = parseInt(betLevelStr || '1');
        // For Narcos, bet_level is 1-10. This is a multiplier. Denomination is coin value.
        // Total bet in game currency for ways games = bet_level * base_bet_coins * denomination.
        // SlotSettingsService.executeSpin expects betPerLine.
        // If paytable payouts are per "coin", then betPerLine should be (bet_level * denomination).
        // If paytable is for total bet, then adjust. Narcos paytable is per coin.
        const coinValueForSpin = betLevel * currentDenomForSpin;

        const linesPlayed = 243; // Narcos specific

        const spinResult: SpinResultDetails = await slotSettingsService.executeSpin(
          coinValueForSpin,
          linesPlayed, // For ways games, this might be symbolic for total bet calculation by paytable.
                       // Or, if paytable is per line, then this is how many lines are active.
                       // Narcos is 243 ways, so effectively all are active.
          action as 'bet' | 'freespin' | 'respin',
          playerIp
        );

        params.append('game.win.cents', Math.round(spinResult.totalWinInGameCurrency * spinBaseUnitMultiplier).toString());
        params.append('credit', Math.round(spinResult.finalBalanceInGameCurrency * spinBaseUnitMultiplier).toString());
        params.append('totalwin.cents', Math.round(spinResult.totalWinInGameCurrency * spinBaseUnitMultiplier).toString());
        params.append('gameover', spinResult.isGameOver ? 'true' : 'false');
        params.append('nextaction', spinResult.nextAction || 'spin');
        params.append('clientaction', action); // Echo action
        params.append('wavecount', '1');
        params.append('multiplier', '1');
        params.append('nearwinallowed', 'true');
        params.append('gamestate.current', spinResult.nextAction === 'freespin' ? 'freespin' : (spinResult.nextAction === 'respin' ? 'respin' : 'basic'));
        params.append('gamestate.stack', spinResult.nextAction === 'freespin' ? 'basic,freespin' : (spinResult.nextAction === 'respin' ? 'basic,respin' : 'basic') ); // Simplified
        params.append('next.rs', spinResult.nextAction === 'basic' ? 'basic' : spinResult.nextAction);


        Object.entries(spinResult.reels).forEach(([reelKey, symbols], index) => {
            const reelNum = parseInt(reelKey.replace('reel', '')) -1;
            params.append(`rs.i0.r.i${reelNum}.syms`, (symbols as string[]).join(','));
            // params.append(`rs.i0.r.i${reelNum}.pos`, '0'); // Placeholder for actual stop positions
            params.append(`rs.i0.r.i${reelNum}.hold`, 'false');
        });

        spinResult.lineWins.forEach((lw, idx) => {
            params.append(`wln.i${idx}.sym`, lw.symbol); // Assuming symbol is already correct format
            params.append(`wln.i${idx}.count`, lw.numMatches.toString());
            params.append(`wln.i${idx}.coins`, Math.round(lw.winAmount / currentDenomForSpin).toString()); // Win in coins
            params.append(`wln.i${idx}.cents`, Math.round(lw.winAmount * spinBaseUnitMultiplier).toString());
            // Positions need to be mapped to what client expects, e.g. p.i0=reel, p.i1=row
            lw.positions.forEach((pos, pIdx) => {
                params.append(`wln.i${idx}.p.i${pIdx}`, `${pos.reel},${pos.row}`);
            });
        });

        if (spinResult.scatterOutcome && spinResult.scatterOutcome.winAmount > 0) {
            params.append(`sc.i0.sym`, spinResult.scatterOutcome.symbol);
            params.append(`sc.i0.coins`, Math.round(spinResult.scatterOutcome.winAmount / currentDenomForSpin).toString());
            params.append(`sc.i0.cents`, Math.round(spinResult.scatterOutcome.winAmount * spinBaseUnitMultiplier).toString());
            params.append(`sc.i0.count`, spinResult.scatterOutcome.count.toString());
        }

        if (spinResult.freeSpinState) {
            params.append('freeround.total', spinResult.freeSpinState.awarded.toString());
            params.append('freeround.current', (spinResult.freeSpinState.awarded - spinResult.freeSpinState.remaining).toString());
            params.append('freeround.totalwin.cents', Math.round(spinResult.freeSpinState.totalWinInGameCurrency * spinBaseUnitMultiplier).toString());
            if(spinResult.freeSpinState.remaining === 0 && action === 'freespin'){ // Last free spin
                 params.append('freeround.gameover', 'true');
            }
        }
        if (spinResult.bonusTriggered && spinResult.bonusDetails?.type === 'freeSpins') {
            params.append('freeround.new', 'true'); // Indicates new FS round triggered
        }


        if (spinResult.walkingWilds && spinResult.walkingWilds.length > 0) {
            const wwPos = spinResult.walkingWilds.map(ww => `${ww.reel},${ww.row},${ww.instanceId || ww.id}`).join(';');
            params.append('walkingwilds.pos', wwPos);
            // walkingwilds.new.pos for newly added ones
        }

        if (spinResult.driveBy?.active) {
            params.append('feature.driveby.active', 'true');
            // feature.driveby.wilds=0,0;1,1;... (reel,row)
        }

        if (spinResult.lockedUp?.active) {
            params.append('feature.lockup.active', 'true');
            params.append('feature.lockup.respinsleft', (spinResult.lockedUp.respinsLeft || 0).toString());
            params.append('feature.lockup.totalwin.coins', Math.round((spinResult.lockedUp.totalWinInGameCurrency || 0) / currentDenomForSpin).toString());
            // feature.lockup.positions=0,0,SYM_X,value;1,1,SYM_Y,value;...
        }

        responseString = params.toString();
        break;

      case 'paytable':
        await slotSettingsService.initialize();
        const paytableData: GamePaytableEntry[] = await gameConfigService.getPaytable(gameIdToUse);
        const currentPaytableDenom = slotSettingsService.getCurrentDenom(); // Denom for which paytable values are shown
        const paytableBaseUnitMultiplier = 1 / currentPaytableDenom;

        params.append('clientaction', 'paytable');
        params.append('denomination', Math.round(currentPaytableDenom * paytableBaseUnitMultiplier).toString()); // Paytable shown for this denom in cents

        // Group paytable entries by symbol
        const groupedPaytable: Record<string, {symbol: string, payouts: {match: number, value: number}[]}> = {};
        paytableData.forEach(entry => {
            if (!groupedPaytable[entry.symbol]) {
                groupedPaytable[entry.symbol] = { symbol: entry.symbol, payouts: [] };
            }
            groupedPaytable[entry.symbol].payouts.push({ match: entry.match_count, value: entry.payout_multiplier });
        });

        let ptIndex = 0;
        for (const symbolData of Object.values(groupedPaytable)) {
            params.append(`pt.i${ptIndex}.id`, symbolData.symbol); // Or 'basic' if only one component
            let compIndex = 0; // For components within a paytable item, if any. Simplified here.
            symbolData.payouts.sort((a,b) => a.match - b.match).forEach(payout => {
                params.append(`pt.i${ptIndex}.comp.i${compIndex}.symbol`, symbolData.symbol);
                params.append(`pt.i${ptIndex}.comp.i${compIndex}.n`, payout.match.toString()); // Number of matches
                params.append(`pt.i${ptIndex}.comp.i${compIndex}.multi`, payout.value.toString()); // Payout multiplier (coins)
                compIndex++;
            });
            // Free spins awarded by symbol (e.g. scatters)
            // if (symbolData.symbol === slotSettingsService.scatterSymbol) {
            //    const fsConfig = slotSettingsService.getGameSetting('slotFreeCountForScatters') as Record<string,number>;
            //    if(fsConfig) params.append(`pt.i${ptIndex}.freespins`, 'true'); // Indicate it gives FS
            // }
            ptIndex++;
        }
        // Add other general paytable info like game rules, feature descriptions etc.
        responseString = params.toString();
        break;

      default:
        throw new HTTPException(400, { message: 'Unknown action' });
    }
    return c.text(responseString);

  } catch (error: any) {
    console.error(`NarcosNET Error - Action: ${action}:`, error.message, error.stack);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Internal Server Error', cause: error });
  }
});

export default narcosNetApp;
