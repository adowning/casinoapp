import { PrismaClient, Prisma } from '../../generated/prisma';

// Instantiate Prisma Client
const prisma = new PrismaClient();

// --- MANUALLY DEFINED DATA ---

// Game Name to Placeholder ID mapping (consistent with migrate_reel_strips.ts)
const gameNameToIdMap: Record<string, number> = {
  'NarcosNET': 1,
  'AfricanKingNG': 2,
};

// --- NarcosNET Data ---
const narcosNETPaytableData: Omit<Prisma.GamePaytableEntryCreateManyInput, 'game_id'>[] = [
  { symbol: 'SYM_1', match_count: 3, payout_multiplier: 20 },
  { symbol: 'SYM_1', match_count: 4, payout_multiplier: 80 },
  { symbol: 'SYM_1', match_count: 5, payout_multiplier: 300 },
  { symbol: 'SYM_2', match_count: 3, payout_multiplier: 15 },
  { symbol: 'SYM_2', match_count: 4, payout_multiplier: 60 },
  { symbol: 'SYM_2', match_count: 5, payout_multiplier: 250 },
  // ... add more paytable entries for NarcosNET
];

const narcosNETSettingsData: Omit<Prisma.GameSettingCreateManyInput, 'game_id'>[] = [
  { setting_name: 'slotFreeCountForScatters', setting_value: JSON.stringify({ '3': 10, '4': 10, '5': 10 }) as Prisma.JsonNullValueInput | Prisma.InputJsonValue },
  { setting_name: 'lines', setting_value: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) as Prisma.JsonNullValueInput | Prisma.InputJsonValue }, // Example lines
  { setting_name: 'denominations', setting_value: JSON.stringify([0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 1.00]) as Prisma.JsonNullValueInput | Prisma.InputJsonValue },
  // ... add more settings for NarcosNET
];

// --- AfricanKingNG Data ---
const africanKingNGPaytableData: Omit<Prisma.GamePaytableEntryCreateManyInput, 'game_id'>[] = [
  { symbol: 'LION', match_count: 3, payout_multiplier: 25 },
  { symbol: 'LION', match_count: 4, payout_multiplier: 100 },
  { symbol: 'LION', match_count: 5, payout_multiplier: 500 },
  { symbol: 'ELEPHANT', match_count: 3, payout_multiplier: 20 },
  { symbol: 'ELEPHANT', match_count: 4, payout_multiplier: 80 },
  { symbol: 'ELEPHANT', match_count: 5, payout_multiplier: 400 },
  // ... add more paytable entries for AfricanKingNG
];

const africanKingNGSettingsData: Omit<Prisma.GameSettingCreateManyInput, 'game_id'>[] = [
  { setting_name: 'freeSpinsTrigger', setting_value: JSON.stringify({ scatterSymbol: 'BONUS_SYMBOL', minCount: 3, spinsAwarded: 10 }) as Prisma.JsonNullValueInput | Prisma.InputJsonValue },
  { setting_name: 'lines', setting_value: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as Prisma.JsonNullValueInput | Prisma.InputJsonValue }, // Example lines
  { setting_name: 'defaultBet', setting_value: 1.00 as Prisma.JsonNullValueInput | Prisma.InputJsonValue },
  // ... add more settings for AfricanKingNG
];


async function mainPaytablesAndSettings() {
  // --- Process NarcosNET ---
  console.log("--- Generating Paytable and Settings Data for NarcosNET ---");
  const narcosNETGameId = gameNameToIdMap['NarcosNET'];

  const finalNarcosNETPaytable: Prisma.GamePaytableEntryCreateManyInput[] = narcosNETPaytableData.map(p => ({ ...p, game_id: narcosNETGameId }));
  const finalNarcosNETSettings: Prisma.GameSettingCreateManyInput[] = narcosNETSettingsData.map(s => ({ ...s, game_id: narcosNETGameId }));

  console.log("NarcosNET Paytable Data (to be inserted):");
  finalNarcosNETPaytable.forEach(data => console.log(data));
  // Example Prisma call for Paytable:
  // if (finalNarcosNETPaytable.length > 0) {
  //   await prisma.gamePaytableEntry.createMany({
  //     data: finalNarcosNETPaytable,
  //     skipDuplicates: true,
  //   });
  //   console.log(`Inserted ${finalNarcosNETPaytable.length} paytable entries for NarcosNET`);
  // }

  console.log("\nNarcosNET Settings Data (to be inserted):");
  finalNarcosNETSettings.forEach(data => console.log(data));
  // Example Prisma call for Settings:
  // if (finalNarcosNETSettings.length > 0) {
  //   await prisma.gameSetting.createMany({
  //     data: finalNarcosNETSettings,
  //     skipDuplicates: true,
  //   });
  //   console.log(`Inserted ${finalNarcosNETSettings.length} settings for NarcosNET`);
  // }

  // --- Process AfricanKingNG ---
  console.log("\n--- Generating Paytable and Settings Data for AfricanKingNG ---");
  const africanKingNGGameId = gameNameToIdMap['AfricanKingNG'];

  const finalAfricanKingNGPaytable: Prisma.GamePaytableEntryCreateManyInput[] = africanKingNGPaytableData.map(p => ({ ...p, game_id: africanKingNGGameId }));
  const finalAfricanKingNGSettings: Prisma.GameSettingCreateManyInput[] = africanKingNGSettingsData.map(s => ({ ...s, game_id: africanKingNGGameId }));

  console.log("AfricanKingNG Paytable Data (to be inserted):");
  finalAfricanKingNGPaytable.forEach(data => console.log(data));
  // Example Prisma call for Paytable:
  // if (finalAfricanKingNGPaytable.length > 0) {
  //   await prisma.gamePaytableEntry.createMany({
  //     data: finalAfricanKingNGPaytable,
  //     skipDuplicates: true,
  //   });
  //   console.log(`Inserted ${finalAfricanKingNGPaytable.length} paytable entries for AfricanKingNG`);
  // }

  console.log("\nAfricanKingNG Settings Data (to be inserted):");
  finalAfricanKingNGSettings.forEach(data => console.log(data));
  // Example Prisma call for Settings:
  // if (finalAfricanKingNGSettings.length > 0) {
  //   await prisma.gameSetting.createMany({
  //     data: finalAfricanKingNGSettings,
  //     skipDuplicates: true,
  //   });
  //   console.log(`Inserted ${finalAfricanKingNGSettings.length} settings for AfricanKingNG`);
  // }
}

// mainPaytablesAndSettings()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });

console.log("migrate_paytables_and_settings.ts loaded. Call mainPaytablesAndSettings() to see output.");
console.log("Example usage: await mainPaytablesAndSettings(); (Prisma calls are commented out)");

// To make it easier for the subtask runner to see example output:
function generateExampleOutputPaytablesAndSettings() {
    console.log("\n--- Example Output for NarcosNET Paytable (first 2) ---");
    narcosNETPaytableData.slice(0,2).map(p => ({ ...p, game_id: gameNameToIdMap['NarcosNET'] })).forEach(d => console.log(d));

    console.log("\n--- Example Output for NarcosNET Settings (first 1) ---");
    narcosNETSettingsData.slice(0,1).map(s => ({ ...s, game_id: gameNameToIdMap['NarcosNET'] })).forEach(d => console.log(d));

    console.log("\n--- Example Output for AfricanKingNG Paytable (first 2) ---");
    africanKingNGPaytableData.slice(0,2).map(p => ({ ...p, game_id: gameNameToIdMap['AfricanKingNG'] })).forEach(d => console.log(d));

    console.log("\n--- Example Output for AfricanKingNG Settings (first 1) ---");
    africanKingNGSettingsData.slice(0,1).map(s => ({ ...s, game_id: gameNameToIdMap['AfricanKingNG'] })).forEach(d => console.log(d));
}

generateExampleOutputPaytablesAndSettings();

export { mainPaytablesAndSettings }; // Export if needed
