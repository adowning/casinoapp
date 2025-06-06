// hono-server/src/services/bankService.ts
import { PrismaClient, GameBank, FishBank, JPG, Prisma } from '../generated/prisma';
import { UserService } from './userService'; // For updateJackpots
import { LogService } from './logService';   // For updateJackpots

export class BankService {
  constructor(private prisma: PrismaClient) {}

  async getBank(shopId: number, bankName: 'slots' | 'bonus' | 'table_bank' | 'little' | 'fish'): Promise<number> {
    if (bankName === 'fish') {
      const fishBank = await this.prisma.fishBank.findUnique({
        where: { shop_id: shopId },
      });
      return fishBank?.fish ?? 0;
    } else {
      const gameBank = await this.prisma.gameBank.findUnique({
        where: { shop_id: shopId },
      });
      // Ensure we return 0 if gameBank is null or the property is nullish
      return gameBank?.[bankName] ?? 0;
    }
  }

  async getAllBanks(shopId: number): Promise<{slots: number; bonus: number; fish: number; table_bank: number; little: number}> {
    const gameBank = await this.prisma.gameBank.findUnique({
      where: { shop_id: shopId },
    });
    const fishBank = await this.prisma.fishBank.findUnique({
      where: { shop_id: shopId },
    });

    return {
      slots: gameBank?.slots ?? 0,
      bonus: gameBank?.bonus ?? 0,
      fish: fishBank?.fish ?? 0,
      table_bank: gameBank?.table_bank ?? 0,
      little: gameBank?.little ?? 0,
    };
  }

  async updateBank(
    shopId: number,
    bankName: 'slots' | 'bonus' | 'table_bank' | 'little' | 'fish',
    value: number, // Assuming value is in game currency (not cents, unless specified for the bank)
    operation: 'inc' | 'dec' | 'update'
  ): Promise<boolean> {
    try {
      const updateData: Prisma.FloatOperationUpdateInput | number =
        operation === 'inc' ? { increment: value } :
        operation === 'dec' ? { decrement: value } :
        value;

      if (bankName === 'fish') {
        await this.prisma.fishBank.upsert({
          where: { shop_id: shopId },
          create: { shop_id: shopId, fish: operation === 'update' ? value : (operation === 'inc' ? value : -value) }, // Initial value if creating
          update: { fish: updateData },
        });
      } else {
        // For GameBank, ensure it exists or create it with initial values
        // Prisma upsert is good here. If creating, other bank values should be initialized.
        const existingGameBank = await this.prisma.gameBank.findUnique({ where: { shop_id: shopId }});
        if (!existingGameBank && operation === 'dec') {
            // Cannot decrement from a non-existent bank or one we are about to create with 0
            console.warn(`Attempted to decrement ${bankName} for shop ${shopId}, but bank does not exist or value is 0.`);
            // Depending on desired behavior, either return false or ensure bank is created with 0
        }

        await this.prisma.gameBank.upsert({
          where: { shop_id: shopId },
          create: {
            shop_id: shopId,
            slots: bankName === 'slots' ? (operation === 'update' ? value : (operation === 'inc' ? value : 0)) : 0,
            bonus: bankName === 'bonus' ? (operation === 'update' ? value : (operation === 'inc' ? value : 0)) : 0,
            table_bank: bankName === 'table_bank' ? (operation === 'update' ? value : (operation === 'inc' ? value : 0)) : 0,
            little: bankName === 'little' ? (operation === 'update' ? value : (operation === 'inc' ? value : 0)) : 0,
          },
          update: { [bankName]: updateData },
        });
      }
      return true;
    } catch (error) {
      console.error(`Error updating bank ${bankName} for shop ${shopId}:`, error);
      return false;
    }
  }

  async updateJackpots(
    shopId: number,
    gameId: number, // Assuming gameId is available for linking jackpot contributions
    betAmount: number, // Assuming this is in game currency units (e.g., dollars/euros, not cents)
    userId: number,
    currentDenom: number, // Denomination of the game currency (e.g., 0.01 for cents if amounts are in cents)
    userService: UserService, // Passed as a dependency
    logService: LogService    // Passed as a dependency
  ): Promise<{jackpotWinAmountInGameCurrency: number, jackpotName?: string, jackpotId?: number}> {
    const jackpots = await this.prisma.jPG.findMany({
      where: { shop_id: shopId, game_id: gameId }, // Or global jackpots if game_id is null
    });

    let totalJackpotWinAmount = 0;
    let wonJackpotInfo: { name?: string, id?: number } = {};

    for (const jackpot of jackpots) {
      if (!jackpot.percent || jackpot.percent <= 0) continue;

      const contribution = (betAmount * jackpot.percent) / 100;
      let newJackpotBalance = (jackpot.balance ?? 0) + contribution;

      // Check for jackpot win (simplified logic)
      // Real jackpot win logic is usually much more complex (e.g., RNG based, specific game events)
      // This is a placeholder for a win condition, e.g., if balance exceeds payout sum
      if (jackpot.pay_sum && newJackpotBalance >= jackpot.pay_sum) {
        const winAmount = jackpot.pay_sum;
        totalJackpotWinAmount += winAmount;
        wonJackpotInfo = { name: jackpot.name ?? undefined, id: jackpot.id };

        newJackpotBalance = jackpot.start_balance ?? 0; // Reset jackpot

        // Award win to user (ensure amounts are consistent, e.g. if banks are in cents)
        await userService.incrementUserBalance(userId, winAmount);

        // Log jackpot win (simplified log entry)
        // In a real system, this would be a more structured log
        await logService.saveGameLog(
            userId,
            gameId,
            'N/A', // IP address might not be available here directly
            `User ${userId} won jackpot ${jackpot.name || jackpot.id} for ${winAmount}`,
            shopId
        );

        console.log(`User ${userId} won jackpot ${jackpot.name || jackpot.id} for ${winAmount}. Balance reset to ${newJackpotBalance}.`);
      }

      await this.prisma.jPG.update({
        where: { id: jackpot.id },
        data: { balance: newJackpotBalance },
      });
    }

    return {
        jackpotWinAmountInGameCurrency: totalJackpotWinAmount,
        jackpotName: wonJackpotInfo.name,
        jackpotId: wonJackpotInfo.id
    };
  }
}
