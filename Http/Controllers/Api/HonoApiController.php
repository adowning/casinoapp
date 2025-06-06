
/*
|--------------------------------------------------------------------------
| 4. Create the API Controller
|--------------------------------------------------------------------------
|
| This controller will handle the actual logic for fetching and returning
| game data as JSON. Create a new file at:
| app/Http/Controllers/Api/HonoApiController.php
|
*/

namespace VanguardLTE\Http\Controllers\Api;

use VanguardLTE\Game;
use VanguardLTE\Http\Controllers\Controller;

class HonoApiController extends Controller
{
    /**
     * Fetch a list of games and return as JSON.
     * This reuses the same query logic from your GamesController
     * but is built specifically for an API response.
     */
    public function getGames()
    {
        // For simplicity, we assume shop_id=1 for the API.
        // You can make this dynamic if needed.
        $shop_id = 1; 

        // Basic query to get viewable games for the primary shop
        $games = Game::where(['view' => 1, 'shop_id' => 0])
                       ->orderBy('name', 'ASC')
                       ->get();

        if ($games->isEmpty()) {
            return response()->json(['data' => [], 'message' => 'No games found.']);
        }
        
        // Transform the data to a clean format
        $formattedGames = $games->map(function ($game) {
            return [
                'id' => $game->id,
                'name' => $game->name,
                'title' => $game->title,
                'shop_id' => $game->shop_id,
                'device' => $game->device,
                'bet_options' => explode(',', $game->bet),
                'denomination' => $game->denomination,
                'rtp' => $game->current_rtp,
            ];
        });

        return response()->json(['data' => $formattedGames]);
    }
}