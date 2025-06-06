import { PrismaClient, UserGameState } from '../generated/prisma'; // Adjust path if necessary
// For Prisma versions < 4.0.0, JsonValue might be from @prisma/client/runtime,
// For >= 4.0.0, it's often from @prisma/client/runtime/library or implicitly handled.
// If using Prisma 5+, direct use of `any` or specific known types for stateValue is common
// as Prisma maps JSON to corresponding JS types.
// Let's use `any` for broad compatibility of `stateValue` passed in, Prisma will handle serialization.
// type JsonValue = any; // Or more specific if all your states conform to a known structure.

const prisma = new PrismaClient();

/**
 * Retrieves all game states for a specific user and game, aggregated into a single object.
 * Keys are state_key, values are the parsed JSON state_value.
 * @param userId The ID of the user.
 * @param gameId The ID of the game.
 * @returns A Promise resolving to a Record<string, any> representing the game state, or an empty object if none found or on error.
 */
async function getUserGameState(userId: number, gameId: number): Promise<Record<string, any>> {
  try {
    const states = await prisma.userGameState.findMany({
      where: { userId, gameId },
    });

    const gameState: Record<string, any> = {};
    for (const state of states) {
      // Prisma's `Json` type should mean `state.state_value` is already a parsed JavaScript object/primitive.
      gameState[state.state_key] = state.state_value;
    }
    return gameState;
  } catch (error) {
    console.error(`[UserGameStateService] Error fetching game state for user ${userId}, game ${gameId}:`, error);
    return {}; // Return empty object on error to ensure consistent return type for consumers
  }
}

/**
 * Retrieves a specific state value for a user and game by its key.
 * @param userId The ID of the user.
 * @param gameId The ID of the game.
 * @param stateKey The specific key for the state to retrieve.
 * @returns A Promise resolving to the state value (parsed JSON), or `null` if not found or on error.
 */
async function getUserSpecificState(userId: number, gameId: number, stateKey: string): Promise<any | null> {
  try {
    const stateEntry = await prisma.userGameState.findUnique({
      where: {
        userId_gameId_state_key: { // Using the compound unique key defined in prisma.schema
          userId,
          gameId,
          state_key: stateKey,
        },
      },
    });

    // `stateEntry.state_value` will be the parsed JSON value.
    return stateEntry ? stateEntry.state_value : null;
  } catch (error) {
    console.error(`[UserGameStateService] Error fetching specific state for user ${userId}, game ${gameId}, key ${stateKey}:`, error);
    return null;
  }
}

/**
 * Updates or creates (upserts) a specific game state for a user.
 * The `stateValue` can be any JSON-serializable type; Prisma handles the conversion.
 * @param userId The ID of the user.
 * @param gameId The ID of the game.
 * @param stateKey The key for the state.
 * @param stateValue The value for the state (should be JSON serializable).
 * @returns A Promise resolving to the updated or created `UserGameState` record, or `null` on error.
 */
async function updateUserGameState(
  userId: number,
  gameId: number,
  stateKey: string,
  stateValue: any, // Using `any` as Prisma's `JsonValue` can be complex depending on version; `any` works if value is JSON-serializable.
): Promise<UserGameState | null> {
  try {
    const updatedState = await prisma.userGameState.upsert({
      where: {
        userId_gameId_state_key: { // Using the compound unique key
          userId,
          gameId,
          state_key: stateKey,
        },
      },
      update: {
        state_value: stateValue // Prisma will serialize this to JSON
      },
      create: {
        userId,
        gameId,
        state_key: stateKey,
        state_value: stateValue, // Prisma will serialize this to JSON
      },
    });
    return updatedState;
  } catch (error) {
    console.error(`[UserGameStateService] Error upserting UserGameState for user ${userId}, game ${gameId}, key ${stateKey}:`, error);
    return null;
  }
}

/**
 * Retrieves all raw UserGameState records (including their IDs, keys, and JSON values) for a specific user and game.
 * This can be useful for debugging, administrative tasks, or specific migration scenarios.
 * @param userId The ID of the user.
 * @param gameId The ID of the game.
 * @returns A Promise resolving to an array of `UserGameState` records, or an empty array if none found or on error.
 */
async function getAllUserGameStatesForGame(userId: number, gameId: number): Promise<UserGameState[]> {
  try {
    return await prisma.userGameState.findMany({
      where: { userId, gameId },
    });
  } catch (error) {
    console.error(`[UserGameStateService] Error fetching all game states for user ${userId}, game ${gameId}:`, error);
    return []; // Return empty array on error
  }
}

export const UserGameStateService = {
  getUserGameState,
  getUserSpecificState,
  updateUserGameState,
  getAllUserGameStatesForGame,
};
