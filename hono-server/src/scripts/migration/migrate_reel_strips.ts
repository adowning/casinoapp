import { PrismaClient, Prisma } from '../../generated/prisma';

// Instantiate Prisma Client
const prisma = new PrismaClient();

// --- Reel Strip Data for NarcosNET ---
const narcosNetReelsContent = `
reelStrip1=11,7,10,9,7,8,11,5,3,10,8,0,11,10,5,8,11,10,2,8,7,11,0,5,3,6,10,11,8,12,9,8,6,4,8,9,11,0,7,10,3,8,6,3,4,5,2,8,9,5,11,2,10,12,11,9,6,8,5,10,8,11,6,12,3,4,0,5,8,10,2,3,6,7,0,10,5,6,3,0,8,10,7,9,5,8,10,11,9,5,6,8,11,3,8,6,4,8,12,10,11,12,9,10,3,2,7,6,2,8,11,4,9,11,8,10,11,5,8,11,4,6,5,7,10,9,11,0,8,11,5,3,10,2,8,10,11,6,5
reelStrip2=6,12,4,9,8,10,12,5,6,12,2,9,7,12,8,4,1,12,11,10,12,6,10,12,3,9,2,4,9,5,12,2,9,8,6,12,10,7,9,5,3,12,11,5,4,12,10,5,2,6,12,7,9,8,4,2,10,11,12,5,9,12,8,4,9,5,12,8,7,9,10,2,12,4,9,8,7,2,12,10,7,9,12,11,5,4,12,9,10,7,9,12,8,4,12,7,11,12,1,8,9,12,8,10,5,9,4,12,6,9,7,10,8,12,5,7,3,9
reelStrip3=6,8,7,4,10,11,12,4,9,6,2,7,3,9,11,7,5,11,6,9,11,4,7,11,12,10,11,3,7,8,11,12,7,4,10,9,7,12,0,6,11,12,7,11,9,10,6,12,7,3,11,7,2,8,12,3,2,6,8,12,11,7,5,4,9,8,6,11,5,12,3,11,9,4,0,7,10,4,11,12,0,8,11,3,6,11,9,8,7,0,12,6,10,7,11,6,2,7,11,12,7,2,10,8,9,4,11,9,7,6,11,2,7,9,6,7,1,6,4,9,12,0,9,6,4,10,12,6,11,2,7,9,5,8,9,3,5,11,4,3,6,9,7,4,11,2,12,9,4,7,5,11,8,10,9,7,11,6,9,0,6,7,4,1,10,0,9
reelStrip4=9,12,5,8,11,4,2,11,5,8,9,4,11,8,10,7,9,2,11,7,2,9,6,11,9,7,12,11,6,7,5,2,9,7,3,5,6,10,7,3,5,7,9,11,3,10,12,5,6,8,9,11,5,12,6,9,4,6,11,9,1,10,2,5,12,7,8,4,11,6,3,5,11,7,10,6,9,10,2,11,9,12,1,8,7,3,11,12,6,5,12,10,9,4,11,9,6,8,5,12,11,9,2,6,9,12,7,6,11,2,7,5,10,9,2,11,6,5,7
reelStrip5=3,10,0,7,12,2,8,3,9,10,2,12,9,3,7,10,5,8,9,12,4,7,9,8,11,6,2,3,7,8,6,10,4,0,9,10,12,9,8,11,9,0,7,11,12,6,7,4,2,9,1,12,8,3,11,12,8,4,6,10,12,9,1,4,10,2,8,10,12,7,9,12,0,10,7,8,4,10,2,12,3,5,10,7,12,2,8,12,11,4,8,3,9,0,10,8,5,9,12,4,11,10,6,8,9,4,12,8,10,7,0,12,8,11,2,12,7,8,4,9,5,2,12,8,7,9,12,8,9,10,4,6,3,10,8,12,11,6,12,2,8,3,12,7,9,12,10,8,7,9,10,11,9,2,8,12,10,8,9,3,10,8,12,4,0,7,11,6
reelStripBonus1=8,3,7,9,8,4,6,10,12,8,10,12,11,6,8,12,4,9,12,8,7,6,10,12,8,10,7,12,5,9,11,6,12,4,8,7,10,6,5,11,12,10,7,4,8,6,11,12,4,7,6,4,12,8,10,11,8,12,6,10,9,7,5,1,4,10,6,12,9,11,8,3,10,7,6,12,4,10,9
reelStripBonus2=3,9,12,11,10,7,8,11,1,9,8,6,5,11,12,10,11,5,9,3,11,8,10,12,11,5,9,11,7,8,3,9,10,7,11,3,10,6,11,8,9,6,7,5,4,6,12,3,11,12,9,6,10,9,11,8,6,5,11,9,10,8,9,3,11,4,5,12,9,7,6
reelStripBonus3=8,3,7,9,8,4,6,10,12,8,10,12,11,6,8,12,4,9,12,8,7,6,10,12,8,10,7,12,5,9,11,6,12,4,8,7,10,6,5,11,12,10,7,4,8,6,11,12,4,7,6,4,12,8,10,11,8,12,6,10,9,7,5,1,4,10,6,12,9,11,8,3,10,7,6,12,4,10,9
reelStripBonus4=3,9,12,11,10,7,8,11,1,9,8,6,5,11,12,10,11,5,9,3,11,8,10,12,11,5,9,11,7,8,3,9,10,7,11,3,10,6,11,8,9,6,7,5,4,6,12,3,11,12,9,6,10,9,11,8,6,5,11,9,10,8,9,3,11,4,5,12,9,7,6
reelStripBonus5=8,3,7,9,8,4,6,10,12,8,10,12,11,6,8,12,4,9,12,8,7,6,10,12,8,10,7,12,5,9,11,6,12,4,8,7,10,6,5,11,12,10,7,4,8,6,11,12,4,7,6,4,12,8,10,11,8,12,6,10,9,7,5,1,4,10,6,12,9,11,8,3,10,7,6,12,4,10,9
`;

// --- Reel Strip Data for AfricanKingNG ---
const africanKingNGReelsContent = `
reelStrip1=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStrip2=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStrip3=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStrip4=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStrip5=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStripBonus1=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStripBonus2=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStripBonus3=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStripBonus4=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
reelStripBonus5=3,8,6,7,4,3,5,7,8,6,2,3,4,0,3,2,5,7,9,3,8,2,3,0,4,3,6,8,7,5,3,4,7,2,3,8,9,2,4,7,6,3,5,2,8,7,4,8,7,6,5,4,3,5,7,4,2,5,6,3,4,5,8,0,4,7,6,8
`;

interface ReelStripData {
  gameName: string;
  stripName: string;
  symbols: string[];
}

function parseReelsContent(gameName: string, content: string): Prisma.GameReelStripCreateManyInput[] {
  const lines = content.trim().split('\n');
  const reelStrips: Prisma.GameReelStripCreateManyInput[] = [];

  for (const line of lines) {
    if (!line.includes('=')) continue;
    const [stripName, symbolsString] = line.split('=');
    const symbols = symbolsString.split(',');

    // Here, we'd normally fetch gameId based on gameName. Using placeholder.
    // const game = await prisma.game.findUnique({ where: { name: gameName } });
    // const gameId = game?.id || -1; // Placeholder if game not found

    reelStrips.push({
      // game_id: gameId, // This would be game_id in the actual schema
      strip_name: stripName.trim(),
      symbols: symbols as Prisma.JsonArray, // Store as JSON array
      game_id: -1 // Placeholder for game_id, replace with actual lookup
    });
  }
  return reelStrips;
}

async function mainReelStrips() {
  console.log("--- Generating Reel Strip Data for NarcosNET ---");
  const narcosNetReelStripData = parseReelsContent('NarcosNET', narcosNetReelsContent);
  narcosNetReelStripData.forEach(data => {
    // This is where we assign a placeholder gameId based on gameName for demonstration
    // In a real scenario, you'd look up the actual game_id
    if (data.strip_name.startsWith('reelStrip') || data.strip_name.startsWith('reelStripBonus')) { // Basic check
        data.game_id = 1; // Placeholder ID for NarcosNET
    }
    console.log(data);
  });
  // Example of what the Prisma call would look like:
  // if (narcosNetReelStripData.length > 0) {
  //   await prisma.gameReelStrip.createMany({
  //     data: narcosNetReelStripData,
  //     skipDuplicates: true,
  //   });
  //   console.log(`Inserted ${narcosNetReelStripData.length} reel strips for NarcosNET`);
  // }

  console.log("\n--- Generating Reel Strip Data for AfricanKingNG ---");
  const africanKingNGReelStripData = parseReelsContent('AfricanKingNG', africanKingNGReelsContent);
  africanKingNGReelStripData.forEach(data => {
    if (data.strip_name.startsWith('reelStrip') || data.strip_name.startsWith('reelStripBonus')) { // Basic check
        data.game_id = 2; // Placeholder ID for AfricanKingNG
    }
    console.log(data);
  });
  // Example of what the Prisma call would look like:
  // if (africanKingNGReelStripData.length > 0) {
  //   await prisma.gameReelStrip.createMany({
  //     data: africanKingNGReelStripData,
  //     skipDuplicates: true,
  //   });
  //   console.log(`Inserted ${africanKingNGReelStripData.length} reel strips for AfricanKingNG`);
  // }
}

// mainReelStrips()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });

console.log("migrate_reel_strips.ts loaded. Call mainReelStrips() to see output.");
console.log("Example usage: await mainReelStrips(); (Prisma calls are commented out)");

// To make it easier for the subtask runner to see example output:
function generateExampleOutputReelStrips() {
    console.log("\n--- Example Output for NarcosNET Reel Strips (first 2) ---");
    const narcosNetData = parseReelsContent('NarcosNET', narcosNetReelsContent).slice(0,2);
    narcosNetData.forEach(d => { d.game_id = 1; console.log(d); });


    console.log("\n--- Example Output for AfricanKingNG Reel Strips (first 2) ---");
    const africanKingData = parseReelsContent('AfricanKingNG', africanKingNGReelsContent).slice(0,2);
    africanKingData.forEach(d => { d.game_id = 2; console.log(d); });
}

generateExampleOutputReelStrips();

export { parseReelsContent, mainReelStrips }; // Export if needed elsewhere
