import { PrismaClient, GameBank, FishBank } from '../generated/prisma'; // Adjust path if necessary

const prisma = new PrismaClient();

// Type for known GameBank fields that can be updated via string name
type GameBankField = 'slots' | 'bonus' | 'table_bank' | 'little';
const gameBankFields: GameBankField[] = ['slots', 'bonus', 'table_bank', 'little'];

/**
 * Retrieves the current value of a specific bank for a given shop.
 * @param shopId The ID of the shop.
 * @param bankType The type of bank (e.g., 'slots', 'bonus', 'fish', 'table_bank', 'little').
 * @returns A Promise resolving to the bank value (number), or 0 if the bank/field is not found. Returns null on fundamental error or invalid bankType.
 */
async function getBank(shopId: number, bankType: string): Promise<number | null> {
  try {
    if (bankType === 'fish') {
      const fishBank = await prisma.fishBank.findUnique({ where: { shopId } });
      return fishBank?.fish ?? 0; // Default to 0 if bank or 'fish' field is null/undefined
    } else if (gameBankFields.includes(bankType as GameBankField)) {
      const gameBank = await prisma.gameBank.findUnique({ where: { shopId } });
      if (gameBank) {
        // Accessing field dynamically. Prisma types should ensure this is a number or null.
        return (gameBank[bankType as GameBankField] as number) ?? 0; // Default to 0 if field is null/undefined
      }
      return 0; // GameBank record itself not found for the shop, so bank value is 0
    } else {
      console.warn(`[BankService] getBank: Invalid bankType requested: ${bankType} for shop ${shopId}`);
      return null; // Invalid bank type specified
    }
  } catch (error) {
    console.error(`[BankService] Error fetching bank '${bankType}' for shop ${shopId}:`, error);
    return null; // Error during database operation
  }
}

/**
 * Updates a specific bank for a given shop by a specified amount.
 * The amount can be positive (to add to the bank) or negative (to subtract).
 * Bank values are prevented from going below zero.
 * If a bank record (GameBank or FishBank) does not exist for the shop, it will be created.
 * @param shopId The ID of the shop.
 * @param bankType The type of bank to update (e.g., 'slots', 'bonus', 'fish').
 * @param amount The amount by which to change the bank value.
 * @returns A Promise resolving to `true` on successful update, `false` on error or invalid bankType.
 */
async function updateBank(shopId: number, bankType: string, amount: number): Promise<boolean> {
  try {
    // Use a transaction to ensure atomicity, especially for the read-modify-write pattern in upsert.
    return await prisma.$transaction(async (tx) => {
      if (bankType === 'fish') {
        const currentFishBank = await tx.fishBank.findUnique({ where: { shopId } });
        const currentFishValue = currentFishBank?.fish ?? 0;
        const newFishValue = Math.max(0, currentFishValue + amount); // Ensure bank doesn't go negative

        await tx.fishBank.upsert({
          where: { shopId },
          create: { shopId, fish: newFishValue },
          update: { fish: newFishValue },
        });
      } else if (gameBankFields.includes(bankType as GameBankField)) {
        const fieldToUpdate = bankType as GameBankField;
        const currentGameBank = await tx.gameBank.findUnique({ where: { shopId } });

        const currentFieldValue = currentGameBank ? (currentGameBank[fieldToUpdate] as number ?? 0) : 0;
        const newGameFieldValue = Math.max(0, currentFieldValue + amount); // Ensure bank doesn't go negative

        // Prepare data for upsert, ensuring other fields default if creating
        const createData: { shopId: number } & Partial<GameBank> = { shopId };
        createData[fieldToUpdate] = newGameFieldValue;

        const updateData: Partial<GameBank> = {};
        updateData[fieldToUpdate] = newGameFieldValue;

        await tx.gameBank.upsert({
          where: { shopId },
          create: createData,
          update: updateData,
        });
      } else {
        console.warn(`[BankService] updateBank: Invalid bankType requested: ${bankType} for shop ${shopId}`);
        // Throwing an error within transaction will cause it to rollback
        throw new Error(`Invalid bankType: ${bankType}`);
      }
      return true; // Success
    });
  } catch (error) {
    console.error(`[BankService] Error updating bank '${bankType}' for shop ${shopId} by amount ${amount}:`, error);
    return false; // Failure
  }
}

export const BankService = {
  getBank,
  updateBank,
};
