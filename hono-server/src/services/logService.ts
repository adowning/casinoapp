// hono-server/src/services/logService.ts
import { PrismaClient, GameLog, StatGame, Prisma } from '../generated/prisma';

export class LogService {
  constructor(private prisma: PrismaClient) {}

  async saveGameLog(
    userId: number,
    gameId: number,
    ip: string,
    logString: string, // Should be a JSON string as per original intent
    shopId: number
  ): Promise<GameLog> {
    return this.prisma.gameLog.create({
      data: {
        user_id: userId,
        game_id: gameId,
        ip: ip,
        str: logString, // Prisma will handle if this needs to be Prisma.JsonNullValueInput etc.
        shop_id: shopId,
        // created_at is handled by @default(now())
      },
    });
  }

  // Interface for StatGame data to ensure type safety and clarity
  // All monetary values (balance, bet, win, banks) should be consistently handled
  // (e.g., always in cents, or always in game currency units)
  // The schema implies Float, so it's game currency units.
  // Denomination is also a float.
  export interface StatGameInput {
    userId: number;
    shopId: number;
    gameName: string; // This will be used to link to Game via game_name_fk
    balance: number;  // User's balance AFTER the transaction
    bet: number;
    win: number;
    denomination: number;
    in_game?: number | null; // Contribution to game banks (e.g., from bet)
    in_jpg?: number | null;  // Contribution to jackpots (e.g., from bet)
    in_profit?: number | null; // System profit from this transaction
    slots_bank: number;   // Current value of slots_bank AFTER this transaction
    bonus_bank: number;   // Current value of bonus_bank AFTER this transaction
    fish_bank: number;    // Current value of fish_bank AFTER this transaction
    table_bank: number;   // Current value of table_bank AFTER this transaction
    little_bank: number;  // Current value of little_bank AFTER this transaction
    total_bank: number;   // Sum of all banks AFTER this transaction
  }

  async saveStatGameReport(data: StatGameInput): Promise<StatGame> {
    // Ensure nullable fields are handled correctly, Prisma expects 'null' not 'undefined' for optional fields not set.
    const statDataForPrisma: Prisma.StatGameCreateInput = {
      user: { connect: { id: data.userId } },
      shop: { connect: { id: data.shopId } },
      game: data.gameName, // Raw game name string
      game_ref: { connect: { name: data.gameName } }, // Link to the Game table via its name
      balance: data.balance,
      bet: data.bet,
      win: data.win,
      denomination: data.denomination,
      in_game: data.in_game === undefined ? null : data.in_game,
      in_jpg: data.in_jpg === undefined ? null : data.in_jpg,
      in_profit: data.in_profit === undefined ? null : data.in_profit,
      slots_bank: data.slots_bank,
      bonus_bank: data.bonus_bank,
      fish_bank: data.fish_bank,
      table_bank: data.table_bank,
      little_bank: data.little_bank,
      total_bank: data.total_bank,
      // date_time is handled by @default(now()) in schema
    };

    return this.prisma.statGame.create({
      data: statDataForPrisma,
    });
  }

  async getRecentGameLogsForUser(userId: number, gameId: number, limit: number = 20): Promise<GameLog[]> {
    return this.prisma.gameLog.findMany({
      where: { user_id: userId, game_id: gameId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  async getRecentStatGameReportsForUser(userId: number, gameName: string, limit: number = 20): Promise<StatGame[]> {
    return this.prisma.statGame.findMany({
        where: {user_id: userId, game_name_fk: gameName}, // Query by foreign key
        orderBy: {date_time: 'desc'},
        take: limit,
    });
  }
}
