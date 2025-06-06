// hono-server/src/services/gameConfigService.ts
import { PrismaClient, Game, GameReelStrip, GamePaytableEntry, GameSetting } from '../generated/prisma';

const prisma = new PrismaClient();

export class GameConfigService {
  async getGameDetailsByName(gameName: string): Promise<Game | null> {
    return prisma.game.findUnique({ where: { name: gameName } });
  }

  async getGameDetailsById(gameId: number): Promise<Game | null> {
    return prisma.game.findUnique({ where: { id: gameId } });
  }

  async getReelStrips(gameId: number): Promise<GameReelStrip[]> {
    return prisma.gameReelStrip.findMany({ where: { game_id: gameId } });
  }

  async getPaytable(gameId: number): Promise<GamePaytableEntry[]> {
    return prisma.gamePaytableEntry.findMany({ where: { game_id: gameId } });
  }

  async getGameSetting(gameId: number, settingName: string): Promise<GameSetting | null> {
    return prisma.gameSetting.findUnique({
      where: { game_id_setting_name: { game_id: gameId, setting_name: settingName } },
    });
  }

  async getAllGameSettings(gameId: number): Promise<GameSetting[]> {
    return prisma.gameSetting.findMany({ where: { game_id: gameId } });
  }
}
