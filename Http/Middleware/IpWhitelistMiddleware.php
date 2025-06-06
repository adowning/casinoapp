
/*
|--------------------------------------------------------------------------
| 2. Create IP Whitelist Middleware
|--------------------------------------------------------------------------
|
| This middleware will be the security gate for our API.
| Generate it with: php artisan make:middleware IpWhitelistMiddleware
| Then, place the following code inside the generated file at:
| app/Http/Middleware/IpWhitelistMiddleware.php
|
*/

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class IpWhitelistMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $allowedIps = explode(',', env('WHITELISTED_IPS', '127.0.0.1'));
        $apiKey = env('HONO_API_KEY');

        // 1. Check if the request's IP is in our whitelist
        if (!in_array($request->ip(), $allowedIps)) {
            // Uncomment the line below for production logging
            // \Log::warning('IP Whitelist Blocked: ' . $request->ip());
            return response()->json(['error' => 'Forbidden: IP not allowed'], 403);
        }

        // 2. Check for the presence of the secret API key
        if (!$request->hasHeader('X-API-KEY')) {
            return response()->json(['error' => 'Forbidden: Missing API Key'], 403);
        }

        // 3. Validate the API key
        if ($request->header('X-API-KEY') !== $apiKey) {
            // Uncomment the line below for production logging
            // \Log::warning('IP Whitelist Blocked: Invalid API Key from ' . $request->ip());
            return response()->json(['error' => 'Forbidden: Invalid API Key'], 403);
        }

        return $next($request);
    }
}
