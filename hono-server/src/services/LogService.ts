import { PrismaClient } from '../generated/prisma'; // Adjust path if necessary

const prisma = new PrismaClient();

export interface GameSpinLogData {
  userId?: number; // Optional: some initial game actions might not have a user context immediately
  gameId?: number; // Numeric ID of the game from the 'Game' table
  gameName?: string; // Name of the game (e.g., 'AfricanKingNG') for the 'StatGame.game' field
  shopId?: number;
  responseData: string; // JSON string of the server's response to the client (for GameLog.str)
  betAmount: number;    // For StatGame.bet
  winAmount: number;    // For StatGame.win
  ipAddress?: string;  // For GameLog.ip
  userBalanceAfterSpin: number; // For StatGame.balance
  denomination?: number; // For StatGame.denomination
  toGameBanks?: number;  // For StatGame.in_game (Amount contributed to game banks)
  toSlotJackBanks?: number; // For StatGame.in_jpg (Amount contributed to jackpots)
  betProfit?: number;    // For StatGame.in_profit (System profit from this bet)
  // Optional: Bank states at the time of log, if available
  slots_bank?: number;
  bonus_bank?: number;
  fish_bank?: number;
  table_bank?: number;
  little_bank?: number;
  total_bank?: number;
}

export interface TransactionLogData {
  userId: number;
  payeerId?: number; // User ID of the admin/cashier who initiated, if applicable (Not directly in StatGame)
  system: string;    // System/reason for transaction (e.g., 'manual_deposit', 'bonus_payout_freespins', 'refund')
  type: 'add' | 'out'; // Type of transaction relative to user's main balance
  sum: number;         // Absolute amount of the transaction
  itemId?: number;      // Optional ID of a related item (e.g. bonus ID triggering a payout) (Not directly in StatGame)
  shopId?: number;
  userBalanceAfterTransaction: number; // User's main balance after this transaction
  customTitle?: string; // For specific log titles, can be used for 'StatGame.game' field
}

/**
 * Logs a game spin event to both GameLog (raw response) and StatGame (parsed financial details).
 * @param data The data for the game spin log.
 */
async function logGameSpin(data: GameSpinLogData): Promise<void> {
  try {
    // 1. Create GameLog record (stores raw server response and basic details)
    await prisma.gameLog.create({
      data: {
        userId: data.userId,
        game_id: data.gameId, // Foreign key to Game table
        shop_id: data.shopId,
        ip: data.ipAddress,
        str: data.responseData, // Store the full server response string
        // created_at is handled by @default(now()) in Prisma schema
      },
    });

    // 2. Create StatGame record (detailed financial statistics for the spin)
    // Ensure userId is provided if your StatGame schema requires it (it typically does)
    if (data.userId === undefined || data.userId === null) {
        console.warn('[LogService] logGameSpin called without userId. StatGame record will be incomplete or fail if userId is mandatory.');
        // Optionally, skip StatGame logging or handle as per application rules
    }

    await prisma.statGame.create({
      data: {
        user_id: data.userId, // Foreign key to User table
        balance: data.userBalanceAfterSpin,
        bet: data.betAmount,
        win: data.winAmount,
        game: data.gameName, // Name of the game being played
        in_game: data.toGameBanks,
        in_jpg: data.toSlotJackBanks,
        in_profit: data.betProfit,
        denomination: data.denomination,
        shop_id: data.shopId, // Foreign key to Shop table
        slots_bank: data.slots_bank,
        bonus_bank: data.bonus_bank,
        fish_bank: data.fish_bank,
        table_bank: data.table_bank,
        little_bank: data.little_bank,
        total_bank: data.total_bank,
        date_time: new Date(), // Prisma schema has @default(now()), but explicit is also fine
        // game_name_fk: data.gameName, // If an explicit FK string field to Game.name exists
      },
    });
  } catch (error) {
    console.error('[LogService] Error in logGameSpin:', error, 'Input Data:', data);
    // Consider re-throwing, or using a more sophisticated error handling/reporting mechanism
  }
}

/**
 * Logs a generic financial transaction (e.g., manual deposit, bonus payout) to the StatGame table.
 * Note: StatGame is primarily designed for game spins. Using it for generic transactions is an adaptation.
 * A dedicated 'FinancialTransactions' or 'Ledger' table might be more semantically appropriate in the long term.
 * @param data The data for the transaction log.
 */
async function logTransaction(data: TransactionLogData): Promise<void> {
  console.warn("[LogService] logTransaction is using StatGame table, which is primarily designed for game spins. This is an adaptation. Consider a dedicated table for generic financial transactions for better semantic fit and to avoid misinterpreting fields like 'bet'/'win' for non-game events.");

  try {
    await prisma.statGame.create({
      data: {
        user_id: data.userId,
        balance: data.userBalanceAfterTransaction,
        // Adapting 'bet' and 'win' fields for generic transactions:
        // 'bet' can represent money out (debit from user), 'win' can represent money in (credit to user).
        bet: data.type === 'out' ? data.sum : 0,
        win: data.type === 'add' ? data.sum : 0,
        game: data.customTitle || data.system, // Use 'system' or 'customTitle' as the 'game' identifier
        shop_id: data.shopId,
        // Other StatGame fields might be set to 0 or null if not applicable for this transaction type
        denomination: null,
        in_game: 0,
        in_jpg: 0,
        in_profit: 0,
        // Bank states are typically not logged for generic transactions unless specifically provided
        slots_bank: null,
        bonus_bank: null,
        fish_bank: null,
        table_bank: null,
        little_bank: null,
        total_bank: null,
        date_time: new Date(),
      },
    });
  } catch (error) {
    console.error('[LogService] Error in logTransaction:', error, 'Input Data:', data);
  }
}

export const LogService = {
  logGameSpin,
  logTransaction,
};
