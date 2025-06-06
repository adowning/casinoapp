<?php
// migrate_paytables.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "-- Paytable Migration Script --\n";

// --- Database Connection (Placeholder - User needs to implement this) ---
function get_new_db_connection() {
    // IMPORTANT: Replace with actual connection details for the new database
    // Example using environment variables (recommended for security):
    /*
    $db_host = getenv('NEW_DB_HOST') ?: '127.0.0.1';
    $db_name = getenv('NEW_DB_NAME') ?: 'new_casino_db';
    $db_user = getenv('NEW_DB_USER') ?: 'user';
    $db_pass = getenv('NEW_DB_PASS') ?: 'password';
    $dsn = "mysql:host={$db_host};dbname={$db_name};charset=utf8mb4";

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    try {
        $pdo = new PDO($dsn, $db_user, $db_pass, $options);
        echo "-- Successfully connected to the new database (host: {$db_host}, dbname: {$db_name}).\n";
        return $pdo;
    } catch (PDOException $e) {
        echo "-- DB Connection failed: " . $e->getMessage() . "\n";
        echo "-- Please configure NEW_DB_HOST, NEW_DB_NAME, NEW_DB_USER, NEW_DB_PASS environment variables or update connection details in the script.\n";
        return null;
    }
    */
    echo "-- NOTE: Database connection function get_new_db_connection() needs to be fully implemented and configured.\n";
    return null; // Return null if connection cannot be established or is not configured
}

function get_game_id_by_name($pdo, $game_name) {
    if (!$pdo) {
        return null;
    }
    try {
        $stmt = $pdo->prepare("SELECT id FROM games WHERE name = :game_name LIMIT 1");
        $stmt->bindParam(':game_name', $game_name, PDO::PARAM_STR);
        $stmt->execute();
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($result) {
            return $result['id'];
        } else {
            echo "-- Game_id not found for game: {$game_name}\n";
            return null;
        }
    } catch (PDOException $e) {
        echo "-- Error fetching game_id for {$game_name}: " . $e->getMessage() . "\n";
        return null;
    }
}

$games_base_path = __DIR__ . '/../../../../../../Games/';
$games_base_path = realpath($games_base_path);

echo "-- Looking for Games directory at: " . ($games_base_path ? $games_base_path : "Path not found") . "\n";
echo "-- Before running for real, ensure the 'games' table in the new database is populated with game names and their corresponding IDs.\n";
echo "-- WARNING: This script uses regex and eval() to parse PHP code, which is fragile and potentially unsafe. Use with caution in a controlled environment.\n";
echo "-- A more robust method would involve PHP's tokenizer or AST parsing.\n";

$pdo = get_new_db_connection();
$sql_output = "";

if (!$games_base_path || !is_dir($games_base_path)) {
    die("-- ERROR: Games directory not found. Please check the path: " . $games_base_path . "\n");
}

$game_directories = new DirectoryIterator($games_base_path);

foreach ($game_directories as $fileinfo) {
    if ($fileinfo->isDir() && !$fileinfo->isDot()) {
        $game_name = $fileinfo->getFilename();
        $slot_settings_file = $fileinfo->getPathname() . '/SlotSettings.php';

        if (!file_exists($slot_settings_file)) {
            $sql_output .= "-- SlotSettings.php not found for game: {$game_name} (skipped paytable)\n";
            continue;
        }

        $sql_output .= "\n-- Processing paytable for game: {$game_name}\n";
        $game_id = null;
        if ($pdo) {
            $game_id = get_game_id_by_name($pdo, $game_name);
        }
        $game_id_for_sql = $game_id ?: "PLACEHOLDER_GAME_ID_FOR_{$game_name}";
         if (!$game_id && $pdo) {
             $sql_output .= "-- WARNING: Could not find game_id for {$game_name}. Using placeholder in SQL.\n";
        }

        $content = file_get_contents($slot_settings_file);

        // Regex to find $this->Paytable assignments. This is complex and might need game-specific tweaks.
        // It tries to capture direct array assignments and ArrayObject instantiations.
        preg_match_all('/\$this->Paytable\s*=\s*(?:new\s+(?:\\\\?ArrayObject)\s*\(\s*)?(\[[\s\S]*?\])\s*(?:\)\s*)?;/i', $content, $matches);

        $paytable_array_string = null;
        if (!empty($matches[1])) {
            // Take the last match, as Paytable might be initialized then populated.
            // This heuristic might not always be correct.
            $paytable_array_string = end($matches[1]);
        } else {
            // Fallback for older syntax or different assignments if any.
            // This part might need more specific regexes if the above doesn't catch all cases.
             preg_match_all('/\$this->Paytable\[.*?\]\s*=\s*(\[[\s\S]*?\])\s*;/i', $content, $member_matches);
             if(!empty($member_matches[0])) {
                // This is more complex: it means Paytable is built member by member.
                // We'd need to reconstruct the whole array definition.
                // For this subtask, this specific case is noted as too complex for simple regex + eval.
                $sql_output .= "-- Paytable for {$game_name} seems to be built member by member. This script version cannot parse it. Manual check needed.\n";
                continue;
             }
        }

        if ($paytable_array_string) {
            $paytable = null;
            try {
                // Basic sanitization: remove comments
                $sanitized_str = preg_replace('!(//[^\n]*\n|\/\*[\s\S]*?\*\/)!', '', $paytable_array_string);
                // Remove trailing commas before closing square bracket or parenthesis (for ArrayObject)
                $sanitized_str = preg_replace('/,\s*(\]|\))/', '$1', $sanitized_str);

                // Attempt to eval the string into a PHP array
                // WARNING: eval() is dangerous and should only be used with trusted input.
                eval("\$paytable_data = {$sanitized_str};");
                if (isset($paytable_data) && is_array($paytable_data)) {
                    $paytable = $paytable_data;
                } else {
                     $sql_output .= "-- Could not evaluate paytable string to array for {$game_name}. String: {$sanitized_str}\n";
                }

            } catch (Throwable $e) {
                $sql_output .= "-- Error evaluating Paytable for {$game_name}: " . $e->getMessage() . ". String: {$paytable_array_string}\n";
                $paytable = null;
            }

            if ($paytable) {
                foreach ($paytable as $symbol_code => $payout_values) {
                    if (is_array($payout_values)) {
                        // IMPORTANT ASSUMPTION: The index of the $payout_values array corresponds to (match_count - 1).
                        // E.g., $payout_values[0] is for 1 match, $payout_values[2] is for 3 matches.
                        // This needs to be verified against the actual game logic or common patterns.
                        // Most slots start payouts from 2 or 3 matches.
                        foreach ($payout_values as $index => $payout_multiplier_val) {
                            $payout_multiplier = floatval($payout_multiplier_val);
                            $match_count = intval($index) + 1; // Assuming 0-indexed array maps to (match_count - 1)

                            // Only record if payout_multiplier is greater than 0
                            if ($payout_multiplier > 0) {
                                $symbol_sql = addslashes($symbol_code);
                                $game_id_sql_val = is_int($game_id_for_sql) ? $game_id_for_sql : "'{$game_id_for_sql}'";

                                $sql_output .= "INSERT INTO GamePaytableEntry (game_id, symbol, match_count, payout_multiplier) VALUES ({$game_id_sql_val}, '{$symbol_sql}', {$match_count}, {$payout_multiplier});\n";
                            }
                        }
                    }
                }
            } else {
                $sql_output .= "-- Could not parse or evaluate Paytable for {$game_name}.\n";
            }
        } else {
            $sql_output .= "-- Paytable definition not found or not matched by regex in {$game_name}.\n";
        }
    }
}

echo "\n-- SQL INSERT Statements Generated --\n";
echo $sql_output;
echo "\n-- Paytable migration script finished.\n";

if (!$pdo) {
    echo "-- NOTE: No database connection was established. SQL statements are generated with placeholders if game_ids could not be determined via DB lookup.\n";
    echo "-- Ensure placeholder game_ids are replaced and database connection is properly configured before execution against the database.\n";
}

?>
