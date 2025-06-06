// hono-server/src/services/slotSettingsService.ts
import { PrismaClient, Game, GameReelStrip, GamePaytableEntry, GameSetting, User, Shop, Prisma } from '../generated/prisma';
import { GameConfigService } from './gameConfigService';
import { UserService } from './userService';
import { BankService } from './bankService';
import { LogService, StatGameInput } from './logService';

interface LinesPercentConfig {
  [configKey: string]: {
    [percentRange: string]: number;
  };
}

export interface LineWin {
    lineIndex: number;
    symbol: string;
    numMatches: number;
    winAmount: number; // In game currency
    positions: { reel: number; row: number }[];
}

export interface ScatterOutcome {
    symbol: string;
    count: number;
    winAmount: number; // In game currency
    positions: { reel: number; row: number }[];
}

export interface ReelAppearance {
    reels: { [key: string]: string[] };
    totalWinInGameCurrency: number;
    lineWins: LineWin[];
    scatterOutcome: ScatterOutcome | null;
    bonusTriggered: boolean;
    bonusDetails?: any;
}

export interface FreeSpinState {
    awarded: number;
    remaining: number;
    totalWinInGameCurrency: number;
    betPerLineInGameCurrency?: number;
    linesPlayed?: number;
}

export interface JackpotOutcome {
    jackpotWinAmountInGameCurrency: number;
    jackpotName?: string;
    jackpotId?: number;
}

export interface SpinResultDetails {
    reels: { [key: string]: string[] };
    lineWins: LineWin[];
    scatterOutcome: ScatterOutcome | null;
    totalWinInGameCurrency: number;
    finalBalanceInGameCurrency: number;
    bonusTriggered: boolean;
    bonusDetails?: any;
    freeSpinState?: FreeSpinState;
    jackpotOutcome?: JackpotOutcome;
    isFreeSpin?: boolean;
    isGameOver?: boolean;
    nextAction?: string;
    betPerLineInGameCurrency?: number;
    linesPlayed?: number;
    denomination: number;
    walkingWilds?: { id: number, reel: number, row: number, new?: boolean, instanceId?: string }[];
    lockedUp?: {
        active: boolean,
        symbols: { reel: number, row: number, symbol: string, value?: number, isSticky?: boolean }[],
        respinsLeft?: number,
        totalWinInGameCurrency?: number
    };
    driveBy?: {
        active: boolean,
        transformedSymbols?: { reel: number, row: number, originalSymbol: string, newSymbol: string }[]
    };
}


export class SlotSettingsService {
  private prisma: PrismaClient;
  private gameDetails!: Game & { shop?: Shop | null };
  private shopDetails!: Shop;
  private shopPercent!: number;
  private currentDenom!: number;
  private reelStrips: { [key: string]: string[] } = {};
  private paytable: Map<string, { [matches: number]: number }> = new Map();
  private gameSettings: Map<string, Prisma.JsonValue> = new Map();

  private spinWinLimitCounter: number = 0;
  private rtpControlCounter: number = 200;

  private paylines: number[][] = [];
  private wildSymbols: string[] = ['WILD', 'SYM_WILD'];
  private scatterSymbol: string = 'SCATTER';

  constructor(
    private gameId: number,
    private userId: number,
    private gameConfigService: GameConfigService,
    private userService: UserService,
    private bankService: BankService,
    private logService: LogService,
  ) {
    this.prisma = new PrismaClient();
    this.paylines = [
        [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2],
        [0,0,1,2,2], [2,2,1,0,0], [1,0,0,0,1], [1,2,2,2,1], [1,0,1,2,1],
        [0,1,1,1,0], [2,1,1,1,2], [1,1,0,1,1], [1,1,2,1,1], [0,2,0,2,0],
        [2,0,2,0,2], [1,2,1,0,1], [2,1,2,1,0], [0,0,0,1,2], [2,2,2,1,0]
    ];
  }

  async initialize(): Promise<void> {
    if (this.gameDetails && this.shopDetails && typeof this.currentDenom === 'number') return;

    const game = await this.gameConfigService.getGameDetailsById(this.gameId);
    if (!game) throw new Error(`Game with ID ${this.gameId} not found.`);
    if (game.shop_id === null) throw new Error('Game does not have an associated shop_id.');

    const shop = await this.prisma.shop.findUnique({ where: { id: game.shop_id } });
    if (!shop || shop.percent === null) throw new Error('Shop or shop percent not found for game.');

    this.gameDetails = { ...game, shop: shop };
    this.shopDetails = shop;
    this.shopPercent = shop.percent;
    this.currentDenom = game.denomination;

    const reelStripsData = await this.gameConfigService.getReelStrips(this.gameId);
    reelStripsData.forEach(strip => {
      if (Array.isArray(strip.symbols)) this.reelStrips[strip.strip_name] = strip.symbols as string[];
      else this.reelStrips[strip.strip_name] = [];
    });

    const paytableData = await this.gameConfigService.getPaytable(this.gameId);
    paytableData.forEach(entry => {
      if (!this.paytable.has(entry.symbol)) this.paytable.set(entry.symbol, {});
      this.paytable.get(entry.symbol)![entry.match_count] = entry.payout_multiplier;
    });

    const gameSettingsData = await this.gameConfigService.getAllGameSettings(this.gameId);
    gameSettingsData.forEach(setting => this.gameSettings.set(setting.setting_name, setting.setting_value));

    const paylinesSetting = this.gameSettings.get('paylines');
    if (paylinesSetting && Array.isArray(paylinesSetting) && paylinesSetting.every(line => Array.isArray(line))) this.paylines = paylinesSetting as number[][];
    const wildSymbolsSetting = this.gameSettings.get('wildSymbols');
    if (wildSymbolsSetting && Array.isArray(wildSymbolsSetting)) this.wildSymbols = wildSymbolsSetting as string[];
    const scatterSymbolSetting = this.gameSettings.get('scatterSymbol');
    if (scatterSymbolSetting && typeof scatterSymbolSetting === 'string') this.scatterSymbol = scatterSymbolSetting;

    const spinWinLimitSaved = await this.userService.getUserGameState(this.userId, this.gameId, 'SpinWinLimitCounter');
    if (typeof spinWinLimitSaved === 'number') this.spinWinLimitCounter = spinWinLimitSaved;
    else await this.userService.setUserGameState(this.userId, this.gameId, 'SpinWinLimitCounter', this.spinWinLimitCounter as Prisma.InputJsonValue);

    const rtpControlCounterSaved = await this.userService.getUserGameState(this.userId, this.gameId, 'RtpControlCounter');
    if (typeof rtpControlCounterSaved === 'number') this.rtpControlCounter = rtpControlCounterSaved;
    else await this.userService.setUserGameState(this.userId, this.gameId, 'RtpControlCounter', this.rtpControlCounter as Prisma.InputJsonValue);

    console.log(`SlotSettingsService initialized for game: ${this.gameDetails.name}, user ID: ${this.userId}. Shop Percent: ${this.shopPercent}, Denom: ${this.currentDenom}`);
  }

  private async saveRtpCounters(): Promise<void> { /* ... (full implementation from Turn 7) ... */
      await this.userService.setUserGameState(this.userId, this.gameId, 'SpinWinLimitCounter', this.spinWinLimitCounter as Prisma.InputJsonValue);
      await this.userService.setUserGameState(this.userId, this.gameId, 'RtpControlCounter', this.rtpControlCounter as Prisma.InputJsonValue);
  }
  public getPaylinePayout(symbol: string, numMatches: number): number { /* ... (full implementation from Turn 7) ... */
    return this.paytable.get(symbol)?.[numMatches] ?? 0;
  }
  public getGameSetting(settingName: string): Prisma.JsonValue | undefined { /* ... (full implementation from Turn 7) ... */
    return this.gameSettings.get(settingName);
  }
  async getSpinSettings( linesPlayed: number, currentSlotEvent: 'bet' | 'freespin' | 'respin' | 'bonus' ): Promise<{ winType: 'win' | 'bonus' | 'none'; spinWinLimit: number; currentMaxWin: number }> { /* ... (full implementation from Turn 7) ... */
    if (!this.gameDetails || this.shopPercent === undefined || !this.shopDetails) { throw new Error("Service not initialized or critical game/shop data missing."); }
    const isBonusEvent = currentSlotEvent === 'bonus' || currentSlotEvent === 'freespin' || currentSlotEvent === 'respin';
    const configSuffix = isBonusEvent ? '_bonus' : ''; let curFieldKeyPart = '10';
    if (linesPlayed <= 1) curFieldKeyPart = '1'; else if (linesPlayed <= 3) curFieldKeyPart = '3'; else if (linesPlayed <= 5) curFieldKeyPart = '5'; else if (linesPlayed <= 7) curFieldKeyPart = '7'; else if (linesPlayed <= 9) curFieldKeyPart = '9';
    const spinConfigKey = `line${curFieldKeyPart}${configSuffix}`; const bonusConfigKey = `line${curFieldKeyPart}${configSuffix}`;
    const linesPercentConfigRaw = this.gameSettings.get('lines_percent_config'); let linesPercentConfig: LinesPercentConfig = {};
    if (typeof linesPercentConfigRaw === 'string') { try { linesPercentConfig = JSON.parse(linesPercentConfigRaw) as LinesPercentConfig; } catch (e) { console.error("Failed to parse lines_percent_config string:", e); linesPercentConfig = {};} } else if (typeof linesPercentConfigRaw === 'object' && linesPercentConfigRaw !== null) { linesPercentConfig = linesPercentConfigRaw as LinesPercentConfig; }
    const spinChances = linesPercentConfig[spinConfigKey] || {}; const bonusChances = linesPercentConfig[bonusConfigKey] || {};
    let currentSpinWinChance = 100; let currentBonusWinChance = 200;
    for (const range in spinChances) { const [min, max] = range.split('_').map(Number); if (this.shopPercent >= min && this.shopPercent <= max) { currentSpinWinChance = spinChances[range]; break; } }
    for (const range in bonusChances) { const [min, max] = range.split('_').map(Number); if (this.shopPercent >= min && this.shopPercent <= max) { currentBonusWinChance = bonusChances[range]; break; } }
    let gameMaxWin = typeof this.gameDetails.rezerv === 'number' ? this.gameDetails.rezerv : (this.getGameSetting('max_win') as number || 10000);
    const statIn = this.gameDetails.stat_in ?? 0; const statOut = this.gameDetails.stat_out ?? 0;
    const rtpRange = statIn > 0 ? (statOut / statIn) * 100 : 0; const RtpControlCycle = this.getGameSetting('rtpControlCycle') as number || 200;
    if (this.rtpControlCounter === 0) { if ((this.shopPercent + Math.random() * 2) < rtpRange && this.spinWinLimitCounter <= 0) { this.spinWinLimitCounter = Math.floor(Math.random() * 26) + 25; } if (currentSlotEvent === 'bet' && this.spinWinLimitCounter > 0) { currentBonusWinChance = 5000; currentSpinWinChance = 20; gameMaxWin = Math.floor(Math.random() * 5) + 1; if (rtpRange < (this.shopPercent - 1)) { this.spinWinLimitCounter = 0; } } this.rtpControlCounter = RtpControlCycle;
    } else if (this.rtpControlCounter < 0) { if ((this.shopPercent + Math.random() * 2) < rtpRange && this.spinWinLimitCounter <= 0) { this.spinWinLimitCounter = Math.floor(Math.random() * 26) + 25; } this.rtpControlCounter--; if (currentSlotEvent === 'bet' && this.spinWinLimitCounter > 0) { currentBonusWinChance = 5000; currentSpinWinChance = 20; gameMaxWin = Math.floor(Math.random() * 5) + 1; if (rtpRange < (this.shopPercent - 1)) { this.spinWinLimitCounter = 0; } } if (this.rtpControlCounter < (-1 * RtpControlCycle) && (this.shopPercent -1) <= rtpRange && rtpRange <= (this.shopPercent + 2)) { this.rtpControlCounter = RtpControlCycle; }
    } else { this.rtpControlCounter--; }
    if (this.spinWinLimitCounter > 0 && currentSlotEvent === 'bet') { this.spinWinLimitCounter--; }
    await this.saveRtpCounters();
    const bonusRoll = Math.floor(Math.random() * currentBonusWinChance) + 1; const spinRoll = Math.floor(Math.random() * currentSpinWinChance) + 1;
    const bankForWinLimit = this.shopDetails.max_win ?? 100000;
    const slotBonusEnabledSetting = this.gameSettings.get('slotBonus');
    const isSlotBonusEnabled = typeof slotBonusEnabledSetting === 'boolean' ? slotBonusEnabledSetting : (typeof slotBonusEnabledSetting === 'string' ? slotBonusEnabledSetting.toLowerCase() === 'true' : true);
    if (bonusRoll === 1 && isSlotBonusEnabled && currentSlotEvent === 'bet') return { winType: 'bonus', spinWinLimit: bankForWinLimit, currentMaxWin: gameMaxWin };
    if (spinRoll === 1) return { winType: 'win', spinWinLimit: bankForWinLimit, currentMaxWin: gameMaxWin };
    return { winType: 'none', spinWinLimit: 0, currentMaxWin: gameMaxWin };
  }
  private calculateLineWin( reelSymbolsOnScreen: string[][], lineDefinition: number[], betPerLine: number ): { winAmount: number; symbol: string; numMatches: number; positions: {reel: number, row: number}[] } | null { /* ... (full implementation from Turn 9) ... */
    const lineSymbols: string[] = []; const winPositions: {reel: number, row: number}[] = [];
    for (let reelIdx = 0; reelIdx < lineDefinition.length; reelIdx++) { const rowIdx = lineDefinition[reelIdx]; if (reelSymbolsOnScreen[reelIdx] && reelSymbolsOnScreen[reelIdx][rowIdx] !== undefined) { lineSymbols.push(reelSymbolsOnScreen[reelIdx][rowIdx]); winPositions.push({reel: reelIdx, row: rowIdx}); } else { console.error("Error: Reel symbols not found for defined payline position.", {reelIdx, rowIdx}); return null; }}
    let firstEffectiveSymbol = ''; let paylineTypeSymbol = ''; let matchCount = 0;
    for (let i = 0; i < lineSymbols.length; i++) { const currentSymbol = lineSymbols[i]; if (i === 0) { firstEffectiveSymbol = currentSymbol; paylineTypeSymbol = this.wildSymbols.includes(currentSymbol) ? '' : currentSymbol; matchCount = 1; } else { if (currentSymbol === firstEffectiveSymbol || this.wildSymbols.includes(currentSymbol) || (paylineTypeSymbol && currentSymbol === paylineTypeSymbol) || (this.wildSymbols.includes(firstEffectiveSymbol) && !this.wildSymbols.includes(currentSymbol) && !paylineTypeSymbol) ) { matchCount++; if (!paylineTypeSymbol && !this.wildSymbols.includes(currentSymbol)) paylineTypeSymbol = currentSymbol; } else break; }}
    if (!paylineTypeSymbol && this.wildSymbols.includes(firstEffectiveSymbol)) paylineTypeSymbol = firstEffectiveSymbol;
    if (this.paytable.has(paylineTypeSymbol)) { const payoutMultiplier = this.paytable.get(paylineTypeSymbol)?.[matchCount] ?? 0; if (payoutMultiplier > 0) return { winAmount: payoutMultiplier * betPerLine, symbol: paylineTypeSymbol, numMatches: matchCount, positions: winPositions.slice(0, matchCount) }; } return null;
  }
  public generateReelAppearance( winType: 'win' | 'bonus' | 'none', currentSlotEvent: 'bet' | 'freespin' | 'respin' | 'bonus', linesPlayedConfig: number, betPerLine: number, currentMaxWin: number ): ReelAppearance { /* ... (full implementation from Turn 9) ... */
    const numReels = parseInt(this.getGameSetting('numReels') as string || '5'); const symbolsPerReelVisible = parseInt(this.getGameSetting('symbolsPerReelVisible') as string || '3'); const maxAttempts = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) { const reelsOnScreenResult: { [key: string]: string[] } = {}; const reelSymbolsMatrix: string[][] = [];
      for (let i = 0; i < numReels; i++) { const reelKey = `reelStrip${i + 1}`; const bonusReelKey = `reelStripBonus${i + 1}`; const stripToUseKey = (currentSlotEvent === 'freespin' || currentSlotEvent === 'bonus') && this.reelStrips[bonusReelKey] ? bonusReelKey : reelKey; const strip = this.reelStrips[stripToUseKey]; if (!strip || strip.length === 0) throw new Error(`Reel strip ${stripToUseKey} is empty or not loaded.`); const startPos = Math.floor(Math.random() * strip.length); const currentReelSymbols: string[] = []; for (let j = 0; j < symbolsPerReelVisible; j++) currentReelSymbols.push(strip[(startPos + j) % strip.length]); reelsOnScreenResult[`reel${i + 1}`] = currentReelSymbols; reelSymbolsMatrix.push(currentReelSymbols); }
      let iterationTotalWin = 0; const iterationLineWins: LineWin[] = []; const activePaylines = this.paylines.slice(0, linesPlayedConfig);
      activePaylines.forEach((lineDefinition, lineIndex) => { const lineWin = this.calculateLineWin(reelSymbolsMatrix, lineDefinition, betPerLine); if (lineWin) { iterationTotalWin += lineWin.winAmount; iterationLineWins.push({ ...lineWin, lineIndex }); } });
      let scatterCount = 0; const scatterPositions: {reel: number, row: number}[] = []; for(let r=0; r < numReels; r++) for(let c=0; c < symbolsPerReelVisible; c++) if(reelSymbolsMatrix[r] && reelSymbolsMatrix[r][c] === this.scatterSymbol) { scatterCount++; scatterPositions.push({reel: r, row: c});}
      let scatterWinAmount = 0; const scatterPayInfo = this.paytable.get(this.scatterSymbol); if(scatterPayInfo && scatterPayInfo[scatterCount]) { const scatterBetMultiplier = this.getGameSetting('scatterBetMultiplier') as 'totalBet' | 'lineBet' || 'lineBet'; const baseBetForScatter = scatterBetMultiplier === 'totalBet' ? betPerLine * linesPlayedConfig : betPerLine; scatterWinAmount = scatterPayInfo[scatterCount] * baseBetForScatter; } iterationTotalWin += scatterWinAmount;
      const finalScatterOutcome: ScatterOutcome | null = scatterCount > 0 ? { symbol: this.scatterSymbol, count: scatterCount, winAmount: scatterWinAmount, positions: scatterPositions } : null;
      let iterationBonusTriggered = false; let bonusDetails: any = null; const freeSpinsConfigRaw = this.getGameSetting('slotFreeCountForScatters'); if (freeSpinsConfigRaw && typeof freeSpinsConfigRaw === 'object' && freeSpinsConfigRaw !== null && !Array.isArray(freeSpinsConfigRaw)) { const freeSpinsConfig = freeSpinsConfigRaw as Record<string, number>; const spinsAwarded = freeSpinsConfig[scatterCount.toString()]; if (spinsAwarded > 0) { iterationBonusTriggered = true; bonusDetails = { type: 'freeSpins', count: spinsAwarded, scatterCount: scatterCount };}}
      if (winType === 'win') if (iterationTotalWin > 0 && iterationTotalWin <= currentMaxWin && !iterationBonusTriggered) return { reels: reelsOnScreenResult, totalWinInGameCurrency: iterationTotalWin, lineWins: iterationLineWins, scatterOutcome: finalScatterOutcome, bonusTriggered: iterationBonusTriggered, bonusDetails };
      else if (winType === 'bonus') if (iterationBonusTriggered && iterationTotalWin <= currentMaxWin) return { reels: reelsOnScreenResult, totalWinInGameCurrency: iterationTotalWin, lineWins: iterationLineWins, scatterOutcome: finalScatterOutcome, bonusTriggered: iterationBonusTriggered, bonusDetails };
      else if (iterationTotalWin === 0 && !iterationBonusTriggered) return { reels: reelsOnScreenResult, totalWinInGameCurrency: 0, lineWins: [], scatterOutcome: finalScatterOutcome, bonusTriggered: false };
    }
    console.warn(`Max attempts reached. Could not generate desired reel appearance for winType: ${winType}. Returning a 'none' outcome.`); const fallbackReels: { [key: string]: string[] } = {}; for (let i = 0; i < numReels; i++) { const reelKey = `reelStrip${i + 1}`; const strip = this.reelStrips[reelKey] || this.reelStrips['reelStrip1']; fallbackReels[`reel${i+1}`] = strip ? strip.slice(0, symbolsPerReelVisible) : Array(symbolsPerReelVisible).fill('SYM_ERR'); } return { reels: fallbackReels, totalWinInGameCurrency: 0, lineWins: [], scatterOutcome: null, bonusTriggered: false };
  }

  async executeSpin( betPerLineInGameCurrency: number, linesPlayed: number, currentSlotEvent: 'bet' | 'freespin' | 'respin' | 'bonus', playerIp: string ): Promise<SpinResultDetails> {
    if (!this.gameDetails || !this.shopDetails || typeof this.currentDenom !== 'number') await this.initialize();
    if (!this.gameDetails || !this.shopDetails || typeof this.currentDenom !== 'number') throw new Error("Service initialization failed or critical data still missing.");

    const baseUnitMultiplier = 1 / this.currentDenom;
    const betPerLineInBaseUnits = Math.round(betPerLineInGameCurrency * baseUnitMultiplier);
    const totalBetInBaseUnits = betPerLineInBaseUnits * linesPlayed;
    let actualBetForStat = totalBetInBaseUnits;
    let isGameOver = true;
    let nextAction = 'spin';

    if (currentSlotEvent === 'bet') {
      await this.userService.decrementUserBalance(this.userId, totalBetInBaseUnits);
      await this.bankService.updateBank(this.shopDetails.id, 'slots', totalBetInBaseUnits, 'inc');
      this.gameDetails.stat_in = new Prisma.Decimal((this.gameDetails.stat_in as unknown as number ?? 0) + totalBetInBaseUnits);
    } else actualBetForStat = 0;

    const spinSettings = await this.getSpinSettings(linesPlayed, currentSlotEvent);
    const appearance = this.generateReelAppearance( spinSettings.winType, currentSlotEvent, linesPlayed, betPerLineInGameCurrency, spinSettings.currentMaxWin );
    let totalWinInGameCurrency = appearance.totalWinInGameCurrency;
    let totalWinInBaseUnits = Math.round(totalWinInGameCurrency * baseUnitMultiplier);

    // Placeholder for feature activations - these should ideally be part of ReelAppearance or determined during it
    let walkingWildsState: SpinResultDetails['walkingWilds'] = undefined;
    let lockedUpState: SpinResultDetails['lockedUp'] = undefined;
    let driveByState: SpinResultDetails['driveBy'] = undefined;

    // Example: Simulate Walking Wilds (very basic)
    if (currentSlotEvent === 'bet' && Math.random() < (this.getGameSetting('walkingWildTriggerChance') as number || 0.1) ) {
        walkingWildsState = [{ id: Date.now(), reel: Math.floor(Math.random() * 5), row: Math.floor(Math.random() * 3), new: true, instanceId: `ww${Date.now()}` }];
        // TODO: Persist walkingWildsState to UserGameState if they are sticky across spins
    }

    // Example: Simulate Drive-By (basic)
    if (currentSlotEvent === 'bet' && Math.random() < (this.getGameSetting('driveByTriggerChance') as number || 0.05) ) {
        driveByState = { active: true, transformedSymbols: [ /* e.g., { reel: 1, row: 1, originalSymbol: 'X', newSymbol: 'WILD'} */ ] };
        // Note: If Drive-By transforms symbols to Wilds, win calculation might need to be re-run or adjusted based on new reel setup.
        // This is a simplification; true implementation would modify reelSymbolsMatrix in generateReelAppearance.
    }

    // Example: Simulate Locked Up feature trigger (basic)
    const lockedUpSymbolToWatch = this.getGameSetting('lockedUpSymbol') as string || 'SYM_GOLDEN_LOCKED';
    let lockedUpTriggerSymbolCount = 0;
    if (appearance.reels) { // Check if reels is defined
        Object.values(appearance.reels).forEach(reelSymbols => {
            reelSymbols.forEach(symbol => { if (symbol === lockedUpSymbolToWatch) lockedUpTriggerSymbolCount++; });
        });
    }
    if (lockedUpTriggerSymbolCount >= (this.getGameSetting('lockedUpTriggerMinCount') as number || 3) && currentSlotEvent === 'bet') { // Typically only on 'bet'
        lockedUpState = { active: true, symbols: [/* Populate with actual locked symbols, their positions and values from screen */], respinsLeft: 3, totalWinInGameCurrency: 0 };
        nextAction = 'respin'; // Or a specific lockedup_spin action
        isGameOver = false;
        await this.userService.setUserGameState(this.userId, this.gameId, 'lockedUpState', lockedUpState as Prisma.InputJsonValue);
    } else if (currentSlotEvent === 'respin') { // Handle ongoing Locked Up feature
        // TODO: Implement respin logic for Locked Up:
        // - Spin only non-sticky reels
        // - Add new sticky symbols, reset respinsLeft if new ones land
        // - Accumulate win
        // - End feature when no respins left or screen full
        // This is a placeholder for where that logic would go.
        const currentLockedUpState = await this.userService.getUserGameState(this.userId, this.gameId, 'lockedUpState') as SpinResultDetails['lockedUp'];
        if(currentLockedUpState?.active){
            // ... respin logic ...
            // For now, just decrement and assume it ends to avoid infinite loop in this placeholder
            currentLockedUpState.respinsLeft = (currentLockedUpState.respinsLeft ?? 1) -1;
            if(currentLockedUpState.respinsLeft <= 0) {
                await this.userService.deleteUserGameState(this.userId, this.gameId, 'lockedUpState');
                nextAction = 'spin'; isGameOver = true;
            } else {
                 await this.userService.setUserGameState(this.userId, this.gameId, 'lockedUpState', currentLockedUpState as Prisma.InputJsonValue);
                 nextAction = 'respin'; isGameOver = false;
            }
            lockedUpState = currentLockedUpState;
        }
    }


    if (totalWinInBaseUnits > 0) {
      await this.userService.incrementUserBalance(this.userId, totalWinInBaseUnits);
      const bankToDecrement = spinSettings.winType === 'bonus' && appearance.bonusTriggered ? 'bonus' : 'slots';
      await this.bankService.updateBank(this.shopDetails.id, bankToDecrement, totalWinInBaseUnits, 'dec');
      this.gameDetails.stat_out = new Prisma.Decimal((this.gameDetails.stat_out as unknown as number ?? 0) + totalWinInBaseUnits);
    }

    let finalJackpotOutcome: JackpotOutcome | undefined = undefined;
    if (currentSlotEvent === 'bet' && (this.gameDetails.jp_1_percent ?? 0) > 0) {
        const jackpotServiceOutcome = await this.bankService.updateJackpots( this.shopDetails.id, this.gameId, betPerLineInGameCurrency, this.userId, this.currentDenom, this.userService, this.logService );
        if (jackpotServiceOutcome.jackpotWinAmountInGameCurrency > 0) {
            const jackpotWinInBaseUnits = Math.round(jackpotServiceOutcome.jackpotWinAmountInGameCurrency * baseUnitMultiplier);
            totalWinInBaseUnits += jackpotWinInBaseUnits; totalWinInGameCurrency += jackpotServiceOutcome.jackpotWinAmountInGameCurrency;
            finalJackpotOutcome = jackpotServiceOutcome;
        }
    }

    let currentFreeSpinState: FreeSpinState | undefined = undefined;
    if (appearance.bonusTriggered && appearance.bonusDetails?.type === 'freeSpins' && currentSlotEvent !== 'freespin' && !lockedUpState?.active) { // Don't trigger FS if LockedUp just triggered
        const awardedCount = appearance.bonusDetails.count || 0;
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinsAwarded', awardedCount as Prisma.InputJsonValue);
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinsRemaining', awardedCount as Prisma.InputJsonValue);
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinBetAmountGameCurrency', betPerLineInGameCurrency as Prisma.InputJsonValue);
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinLinesPlayed', linesPlayed as Prisma.InputJsonValue);
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinsTotalWinBaseUnits', 0 as Prisma.InputJsonValue);
        currentFreeSpinState = { awarded: awardedCount, remaining: awardedCount, totalWinInGameCurrency: 0, betPerLineInGameCurrency, linesPlayed };
        isGameOver = false; nextAction = 'freespin';
    } else if (currentSlotEvent === 'freespin') {
        let remainingSpins = (await this.userService.getUserGameState(this.userId, this.gameId, 'freeSpinsRemaining') as number) ?? 0;
        let currentTotalFsWinBaseUnits = (await this.userService.getUserGameState(this.userId, this.gameId, 'freeSpinsTotalWinBaseUnits') as number) ?? 0;
        const awarded = (await this.userService.getUserGameState(this.userId, this.gameId, 'freeSpinsAwarded') as number) ?? 0;
        const fsBet = (await this.userService.getUserGameState(this.userId, this.gameId, 'freeSpinBetAmountGameCurrency') as number) ?? betPerLineInGameCurrency;
        const fsLines = (await this.userService.getUserGameState(this.userId, this.gameId, 'freeSpinLinesPlayed') as number) ?? linesPlayed;
        currentTotalFsWinBaseUnits += totalWinInBaseUnits; remainingSpins -= 1;
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinsTotalWinBaseUnits', currentTotalFsWinBaseUnits as Prisma.InputJsonValue);
        await this.userService.setUserGameState(this.userId, this.gameId, 'freeSpinsRemaining', remainingSpins as Prisma.InputJsonValue);
        currentFreeSpinState = { awarded, remaining: remainingSpins, totalWinInGameCurrency: currentTotalFsWinBaseUnits / baseUnitMultiplier, betPerLineInGameCurrency: fsBet, linesPlayed: fsLines };
        if (remainingSpins > 0) { isGameOver = false; nextAction = 'freespin'; }
        else {
            await this.userService.deleteUserGameState(this.userId, this.gameId, 'freeSpinsAwarded');
            await this.userService.deleteUserGameState(this.userId, this.gameId, 'freeSpinsRemaining');
            await this.userService.deleteUserGameState(this.userId, this.gameId, 'freeSpinBetAmountGameCurrency');
            await this.userService.deleteUserGameState(this.userId, this.gameId, 'freeSpinLinesPlayed');
            await this.userService.deleteUserGameState(this.userId, this.gameId, 'freeSpinsTotalWinBaseUnits');
            nextAction = 'spin';
        }
    }

    const finalUserBalanceBaseUnits = (await this.userService.getUserBalance(this.userId)) ?? 0;
    const allBanks = await this.bankService.getAllBanks(this.shopDetails.id);
    const logSummary = { reels: appearance.reels, lineWins: appearance.lineWins, scatter: appearance.scatterOutcome, totalWinBase: totalWinInBaseUnits, bonus: appearance.bonusDetails, fsState: currentFreeSpinState, jackpot: finalJackpotOutcome, walkingWilds: walkingWildsState, lockedUp: lockedUpState, driveBy: driveByState };
    await this.logService.saveGameLog(this.userId, this.gameId, playerIp, JSON.stringify(logSummary), this.shopDetails.id);
    const statData: StatGameInput = {
      userId: this.userId, shopId: this.shopDetails.id, gameName: this.gameDetails.name, balance: finalUserBalanceBaseUnits, bet: actualBetForStat, win: totalWinInBaseUnits, denomination: this.currentDenom,
      in_game: currentSlotEvent === 'bet' ? totalBetInBaseUnits : 0, in_jpg: 0,
      in_profit: currentSlotEvent === 'bet' ? totalBetInBaseUnits - totalWinInBaseUnits : -totalWinInBaseUnits,
      slots_bank: allBanks.slots, bonus_bank: allBanks.bonus, fish_bank: allBanks.fish, table_bank: allBanks.table_bank, little_bank: allBanks.little,
      total_bank: Object.values(allBanks).reduce((sum, val) => sum + val, 0),
    };
    await this.logService.saveStatGameReport(statData);
    await this.userService.updateUserLastBid(this.userId);
    await this.prisma.game.update({ where: {id: this.gameId}, data: { stat_in: this.gameDetails.stat_in, stat_out: this.gameDetails.stat_out, bids: {increment: 1} } });

    // Persist last reels state
    await this.userService.setUserGameState(this.userId, this.gameId, 'lastReels', { reels: appearance.reels } as Prisma.InputJsonValue);


    return {
      reels: appearance.reels, lineWins: appearance.lineWins, scatterOutcome: appearance.scatterOutcome,
      totalWinInGameCurrency: totalWinInGameCurrency,
      finalBalanceInGameCurrency: finalUserBalanceBaseUnits / baseUnitMultiplier,
      bonusTriggered: appearance.bonusTriggered, bonusDetails: appearance.bonusDetails,
      freeSpinState: currentFreeSpinState, jackpotOutcome: finalJackpotOutcome,
      isFreeSpin: currentSlotEvent === 'freespin', betPerLineInGameCurrency, linesPlayed, denomination: this.currentDenom,
      isGameOver, nextAction,
      walkingWilds: walkingWildsState, lockedUp: lockedUpState, driveBy: driveByState
    };
  }

  // Helper methods for init action
  public getDenominations(): number[] {
    const denoms = this.gameSettings.get('denominations');
    if (Array.isArray(denoms)) return denoms.filter(d => typeof d === 'number') as number[];
    return [0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 1.00]; // Default
  }

  public getBetLevels(): number[] {
    const levels = this.gameSettings.get('betLevels');
    if (Array.isArray(levels)) return levels.filter(l => typeof l === 'number') as number[];
    return [1, 2, 3, 4, 5, 10]; // Default
  }

  async getLastReelsState(): Promise<{ reels: { [key: string]: string[] } }> {
    const lastReelsState = await this.userService.getUserGameState(this.userId, this.gameId, 'lastReels');
    if (lastReelsState && typeof lastReelsState === 'object' && !Array.isArray(lastReelsState) && (lastReelsState as any)['reels']) {
      return lastReelsState as { reels: { [key: string]: string[] } };
    }
    const numReels = parseInt(this.getGameSetting('numReels') as string || '5');
    const symbolsPerReelVisible = parseInt(this.getGameSetting('symbolsPerReelVisible') as string || '3');
    const defaultReels: { [key: string]: string[] } = {};
    for (let i = 0; i < numReels; i++) {
        const reelKey = `reelStrip${i + 1}`;
        const strip = this.reelStrips[reelKey] || this.reelStrips['reelStrip1'];
        defaultReels[`reel${i + 1}`] = strip ? strip.slice(0, symbolsPerReelVisible) : Array(symbolsPerReelVisible).fill('SYM_DEFAULT');
    }
    return { reels: defaultReels };
  }

  async getCurrentGamestate(): Promise<string> {
    const freeSpinsRemaining = await this.userService.getUserGameState(this.userId, this.gameId, 'freeSpinsRemaining');
    if (typeof freeSpinsRemaining === 'number' && freeSpinsRemaining > 0) return 'freespin';
    const lockedUpState = await this.userService.getUserGameState(this.userId, this.gameId, 'lockedUpState') as SpinResultDetails['lockedUp'];
    if (lockedUpState?.active && (lockedUpState.respinsLeft ?? 0) > 0) return 'respin'; // Or 'lockedup'
    return 'basic';
  }

  public getCurrentDenom(): number {
    if (typeof this.currentDenom !== 'number') throw new Error("Denomination not initialized. Call initialize() first.");
    return this.currentDenom;
  }

  async setCurrentDenom(denomInput: number | string): Promise<void> {
    const denom = typeof denomInput === 'string' ? parseFloat(denomInput) : denomInput;
    const validDenominations = this.getDenominations();
    if (!validDenominations.includes(denom)) throw new Error(`Invalid denomination: ${denom}. Valid are: ${validDenominations.join(', ')}`);
    this.currentDenom = denom;
    await this.userService.setUserGameState(this.userId, this.gameId, 'currentDenom', denom as Prisma.InputJsonValue);
  }

  async getBalanceInGameCurrency(): Promise<number> {
    const balanceInBaseUnits = await this.userService.getUserBalance(this.userId);
    if (balanceInBaseUnits === null) throw new Error("User balance not found.");
    if (typeof this.currentDenom !== 'number') await this.initialize();
    if (typeof this.currentDenom !== 'number') throw new Error("Denomination not initialized after attempt.");
    // Ensure currentDenom is not zero to prevent division by zero if baseUnitMultiplier logic was different
    if (this.currentDenom === 0) throw new Error("Current denomination cannot be zero.");
    return balanceInBaseUnits * this.currentDenom;
  }
}
