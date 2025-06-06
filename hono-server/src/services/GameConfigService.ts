import {
  PrismaClient,
  Game,
  GameSetting, // Not used directly as type after include, but good for reference
  GameReelStrip, // Not used directly as type after include
  GamePaytableEntry,
} from '../generated/prisma'; // Adjust path if necessary

const prisma = new PrismaClient();

/**
 * Represents the fully aggregated configuration for a game.
 * It extends the base Prisma 'Game' type (omitting the raw relational fields)
 * and adds processed structures for settings, reel strips, and the paytable.
 */
export interface FullGameConfig extends Omit<Game, 'game_settings' | 'game_reel_strips' | 'game_paytable_entries'> {
  settings: Record<string, any>; // Key-value store of GameSetting values (JSON parsed)
  reel_strips: Record<string, string[]>; // Key (strip_name) to array of symbols
  paytable: GamePaytableEntry[]; // Array of paytable entries, kept as is from Prisma
}

/**
 * Fetches and aggregates all configuration data for a specific game by its name.
 * This includes the main game record, all its settings, reel strips, and paytable entries.
 * @param gameName The unique name of the game (e.g., 'CreatureFromTheBlackLagoonNET').
 * @returns A Promise that resolves to a `FullGameConfig` object or `null` if the game is not found or an error occurs.
 */
async function getGameConfigByName(gameName: string): Promise<FullGameConfig | null> {
  try {
    const game = await prisma.game.findUnique({
      where: { name: gameName },
      include: {
        // These are the relation names defined in prisma.schema
        game_settings: true,
        game_reel_strips: true,
        game_paytable_entries: true,
      },
    });

    if (!game) {
      console.warn(`[GameConfigService] Game configuration not found for game: ${gameName}`);
      return null;
    }

    // Process GameSettings: Prisma's `Json` type should mean `setting_value` is already parsed.
    // If `setting_value` were a string needing `JSON.parse()`, error handling would be critical.
    const settings: Record<string, any> = {};
    if (game.game_settings) {
      for (const setting of game.game_settings) {
        // setting.setting_value is of type Prisma.JsonValue.
        // This can be string, number, boolean, null, array, or object.
        settings[setting.setting_name] = setting.setting_value;
      }
    }

    // Process GameReelStrips: Similar to GameSettings, `symbols` should be parsed by Prisma.
    const reel_strips: Record<string, string[]> = {};
    if (game.game_reel_strips) {
      for (const strip of game.game_reel_strips) {
        // strip.symbols is of type Prisma.JsonValue. We expect it to be string[].
        if (Array.isArray(strip.symbols)) {
          // Ensure all elements are strings, though Prisma's Json handling for arrays of primitives should be fine.
          reel_strips[strip.strip_name] = strip.symbols.map(String);
        } else {
          console.error(
            `[GameConfigService] GameReelStrip symbols for game ${gameName}, strip ${strip.strip_name} is not an array as expected. Value:`,
            strip.symbols,
          );
          reel_strips[strip.strip_name] = []; // Default to empty array on unexpected type
        }
      }
    }

    // The GamePaytableEntry items are used directly as they are already structured.

    // Destructure to remove the original relational arrays from the top level of the game object,
    // as we have processed them into the `settings` and `reel_strips` maps.
    const { game_settings, game_reel_strips, game_paytable_entries, ...baseGameData } = game;

    const fullConfig: FullGameConfig = {
      ...baseGameData, // Spread all direct fields from the Game model
      settings,
      reel_strips,
      paytable: game.game_paytable_entries || [], // Use fetched entries or default to empty array
    };

    return fullConfig;
  } catch (error) {
    console.error(`[GameConfigService] Error fetching game configuration for ${gameName}:`, error);
    return null;
  }
}

export const GameConfigService = {
  getGameConfigByName,
};
