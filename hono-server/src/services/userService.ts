// hono-server/src/services/userService.ts
import { PrismaClient, User, GameLog, UserGameState, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

export class UserService {
  async getUser(userId: number): Promise<User | null> {
    return prisma.user.findUnique({ where: { id: userId } });
  }

  async getUserBalance(userId: number): Promise<number | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user?.balance ?? null;
  }

  async setUserBalance(userId: number, newBalance: number): Promise<User | null> {
    return prisma.user.update({
      where: { id: userId },
      data: { balance: newBalance, updated_at: new Date() },
    });
  }

  async incrementUserBalance(userId: number, amount: number): Promise<User | null> {
     return prisma.user.update({
         where: { id: userId },
         data: { balance: { increment: amount }, updated_at: new Date() },
     });
  }

 async decrementUserBalance(userId: number, amount: number): Promise<User | null> {
     return prisma.user.update({
         where: { id: userId },
         data: { balance: { decrement: amount }, updated_at: new Date() },
     });
 }

  async getUserGameState(userId: number, gameId: number, key: string): Promise<Prisma.JsonValue | null> {
    const state = await prisma.userGameState.findUnique({
      where: { user_id_game_id_state_key: { user_id: userId, game_id: gameId, state_key: key } },
    });
    return state?.state_value ?? null;
  }

  async setUserGameState(userId: number, gameId: number, key: string, value: Prisma.JsonValue): Promise<UserGameState> {
    return prisma.userGameState.upsert({
      where: { user_id_game_id_state_key: { user_id: userId, game_id: gameId, state_key: key } },
      update: { state_value: value },
      create: { user_id: userId, game_id: gameId, state_key: key, state_value: value },
    });
  }

  async deleteUserGameState(userId: number, gameId: number, key: string): Promise<UserGameState | null> {
     try {
         return await prisma.userGameState.delete({
             where: { user_id_game_id_state_key: { user_id: userId, game_id: gameId, state_key: key } },
         });
     } catch (error: any) {
         // Handle cases where the record might not exist, depending on Prisma version behavior
         if (error.code === 'P2025') { // Record to delete does not exist (Prisma error code)
             return null;
         }
         throw error;
     }
  }

  async getGameHistory(userId: number, gameId: number, limit: number = 10): Promise<Pick<GameLog, 'str'>[]> {
    return prisma.gameLog.findMany({
      where: { user_id: userId, game_id: gameId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { str: true }, // Select only the 'str' field
    });
  }

  async updateUserLastBid(userId: number): Promise<User | null> {
     return prisma.user.update({
         where: { id: userId },
         data: { last_bid: new Date() }
     });
  }
}
