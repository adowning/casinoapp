<?php
// migrate_game_settings.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "-- Game Settings Migration Script --\n";

// --- Database Connection Placeholders ---
function get_old_db_connection() {
    echo "-- NOTE: OLD Database connection function get_old_db_connection() needs to be implemented.\n";
    // Example:
    /*
    $db_host = getenv('OLD_DB_HOST') ?: 'localhost';
    $db_name = getenv('OLD_DB_NAME') ?: 'old_casino_db';
    $db_user = getenv('OLD_DB_USER') ?: 'old_user';
    $db_pass = getenv('OLD_DB_PASS') ?: 'old_password';
    $dsn = "mysql:host={$db_host};dbname={$db_name};charset=utf8mb4";
    $options = [ PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC ];
    try {
        $pdo = new PDO($dsn, $db_user, $db_pass, $options);
        echo "-- Successfully connected to the OLD database.\n";
        return $pdo;
    } catch (PDOException $e) {
        echo "-- OLD DB Connection failed: " . $e->getMessage() . "\n";
        return null;
    }
    */
    return null;
}

function get_new_db_connection() {
    echo "-- NOTE: NEW Database connection function get_new_db_connection() needs to be implemented.\n";
    // See migrate_reels.php for an example implementation
    return null;
}

function get_game_id_by_name_new_db($pdo_new, $game_name) {
    if (!$pdo_new) return null;
    try {
        $stmt = $pdo_new->prepare("SELECT id FROM games WHERE name = :game_name LIMIT 1");
        $stmt->bindParam(':game_name', $game_name, PDO::PARAM_STR);
        $stmt->execute();
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        return $result ? $result['id'] : null;
    } catch (PDOException $e) {
        echo "-- Error fetching new game_id for {$game_name}: " . $e->getMessage() . "\n";
        return null;
    }
}

// Simplified representation of VanguardLTE\Game::$values for defaults
// In a real scenario, you would include Game.php or have a better way to access this.
class TempGameValues {
    public static $values = [
        'denomination' => ['0.01', '0.02', '0.05', '0.10', '0.20', '0.50', '1.00', '2.00', '5.00'],
        'bet' => ['0.10,0.20,0.50,1.00,2.00', '10,20,50,100'],
        // Add other relevant default arrays from Game.php::$values if needed
    ];
}

$games_base_path = realpath(__DIR__ . '/../../../../../../Games/');
echo "-- Games directory path: " . ($games_base_path ?: "Not Found") . "\n";
echo "-- WARNING: This script uses regex and eval() for parsing SlotSettings.php, which is fragile. Use with caution.\n";

$pdo_old = get_old_db_connection();
$pdo_new = get_new_db_connection();
$sql_output = "";

if (!$pdo_old) {
    die("-- ERROR: Connection to OLD database is required to fetch game configurations. Exiting.\n");
}

// Fetch games from the OLD database
$stmt_old_games = null;
try {
    $query_old_games = "SELECT id AS old_game_id, name, title, bet, denomination, lines_percent_config_spin, lines_percent_config_spin_bonus, lines_percent_config_bonus, lines_percent_config_bonus_bonus, rezerv, cask, gamebank, slotViewState, view, device, scaleMode, jp_1_percent, jp_2_percent, jp_3_percent, jp_4_percent, jp_5_percent, jp_6_percent, jp_7_percent, jp_8_percent, jp_9_percent, jp_10_percent, chanceFirepot1, chanceFirepot2, chanceFirepot3, fireCount1, fireCount2, fireCount3 FROM games ORDER BY name";
    $stmt_old_games = $pdo_old->query($query_old_games);
} catch (PDOException $e) {
    die("-- ERROR: Failed to query OLD games table: " . $e->getMessage() . "\n");
}

$all_game_settings = []; // To store settings before outputting, to allow overrides

while ($row = $stmt_old_games->fetch(PDO::FETCH_ASSOC)) {
    $game_name = $row['name'];
    $sql_output .= "\n-- Processing settings for game: {$game_name} (Old ID: {$row['old_game_id']})\n";

    $new_game_id = null;
    if($pdo_new) {
        $new_game_id = get_game_id_by_name_new_db($pdo_new, $game_name);
    }
    $new_game_id_for_sql = $new_game_id ?: "PLACEHOLDER_GAME_ID_FOR_{$game_name}";
    if (!$new_game_id && $pdo_new) {
        $sql_output .= "-- WARNING: Could not find game_id for {$game_name} in NEW DB. Using placeholder.\n";
    }

    // Helper to add settings, ensuring values are json_encoded
    $add_setting = function($setting_name, $value) use ($game_name, &$all_game_settings) {
        if ($value === null || $value === '') return; // Skip empty or null values

        // If value is already a JSON string (e.g. from lines_percent_config_...)
        // A simple check: if it starts with { or [ and ends with } or ]
        if (is_string($value) && strlen($value) > 1 &&
            ((substr($value, 0, 1) == '{' && substr($value, -1) == '}') ||
             (substr($value, 0, 1) == '[' && substr($value, -1) == ']'))) {
            // Assume it's valid JSON, store as is.
            // Forcing re-encode ensures validity and consistent format.
            $decoded = json_decode($value);
            if (json_last_error() === JSON_ERROR_NONE) {
                 $all_game_settings[$game_name][$setting_name] = json_encode($decoded);
            } else {
                 $all_game_settings[$game_name][$setting_name] = json_encode($value); // Fallback: encode the string itself
            }
        } else {
            // For comma-separated strings like 'bet', convert to array first
            if ($setting_name === 'bet' && is_string($value)) {
                $value = array_map('trim', explode(',', $value));
            }
            $all_game_settings[$game_name][$setting_name] = json_encode($value);
        }
    };

    // 1. Settings from 'games' table row
    $fields_from_games_table = [
        'title', 'bet', 'denomination', 'lines_percent_config_spin', 'lines_percent_config_spin_bonus',
        'lines_percent_config_bonus', 'lines_percent_config_bonus_bonus', 'rezerv', 'cask', 'gamebank',
        'slotViewState', 'view', 'device', 'scaleMode', 'jp_1_percent', 'jp_2_percent', 'jp_3_percent',
        'jp_4_percent', 'jp_5_percent', 'jp_6_percent', 'jp_7_percent', 'jp_8_percent', 'jp_9_percent',
        'jp_10_percent', 'chanceFirepot1', 'chanceFirepot2', 'chanceFirepot3', 'fireCount1', 'fireCount2', 'fireCount3'
    ];
    foreach ($fields_from_games_table as $field) {
        if (isset($row[$field])) {
            $add_setting($field, $row[$field]);
        }
    }

    // 2. Settings from SlotSettings.php (Regex approach - very fragile)
    $slot_settings_file = $games_base_path . '/' . $game_name . '/SlotSettings.php';
    if ($games_base_path && file_exists($slot_settings_file)) {
        $content = file_get_contents($slot_settings_file);

        // Example for slotFreeCount (integer)
        if (preg_match('/\$this->slotFreeCount\s*=\s*([0-9]+)\s*;/i', $content, $matches)) {
            $add_setting('slotFreeCount', intval($matches[1]));
        }
        // Example for slotFreeMpl (integer)
        if (preg_match('/\$this->slotFreeMpl\s*=\s*([0-9]+)\s*;/i', $content, $matches)) {
            $add_setting('slotFreeMpl', intval($matches[1]));
        }
        // Example for slotWildMpl (integer)
        if (preg_match('/\$this->slotWildMpl\s*=\s*([0-9]+)\s*;/i', $content, $matches)) {
            $add_setting('slotWildMpl', intval($matches[1]));
        }
        // Example for Denominations array
        if (preg_match('/\$this->Denominations\s*=\s*([^;]+);/i', $content, $matches)) {
            $denominations_str = trim($matches[1]);
            if (strpos($denominations_str, '[') === 0 || stripos($denominations_str, 'array(') === 0) {
                try {
                    $parsed_denominations = null;
                    eval("\$parsed_denominations = " . $denominations_str . ";");
                    if (isset($parsed_denominations) && is_array($parsed_denominations)) {
                        $add_setting('Denominations', $parsed_denominations);
                    }
                } catch (Throwable $e) {
                    $sql_output .= "-- Error evaluating Denominations from {$game_name}/SlotSettings.php: " . $e->getMessage() . "\n";
                }
            }
        }
        // Add more regexes for other common SlotSettings properties if identifiable patterns exist.
        // E.g., slotBonusType, slotScatterType, GambleType
        if (preg_match('/\$this->slotBonusType\s*=\s*([0-9]+)\s*;/i', $content, $matches)) {
            $add_setting('slotBonusType', intval($matches[1]));
        }
        if (preg_match('/\$this->slotScatterType\s*=\s*([0-9]+)\s*;/i', $content, $matches)) {
            $add_setting('slotScatterType', intval($matches[1]));
        }
         if (preg_match('/\$this->GambleType\s*=\s*([0-9]+)\s*;/i', $content, $matches)) {
            $add_setting('GambleType', intval($matches[1]));
        }

    } else {
        if ($games_base_path) $sql_output .= "-- SlotSettings.php not found for game: {$game_name}\n";
    }

    // 3. Settings from Game::$values (Defaults)
    // These should only be added if not already set from the specific game's data
    if (!isset($all_game_settings[$game_name]['denomination'])) {
         $add_setting('default_denominations', TempGameValues::$values['denomination']);
    }
    if (!isset($all_game_settings[$game_name]['bet'])) {
         $add_setting('default_bet_options', TempGameValues::$values['bet']);
    }
}


// Generate SQL INSERT statements from the collected settings
foreach($all_game_settings as $game_name => $settings) {
    $current_game_id_for_sql = "PLACEHOLDER_GAME_ID_FOR_{$game_name}";
    if($pdo_new) {
        $fetched_id = get_game_id_by_name_new_db($pdo_new, $game_name);
        if($fetched_id) {
            $current_game_id_for_sql = $fetched_id;
        }
    }
    $game_id_sql_val = is_int($current_game_id_for_sql) ? $current_game_id_for_sql : "'{$current_game_id_for_sql}'";

    foreach($settings as $setting_name => $json_value) {
        $setting_name_sql = addslashes($setting_name);
        $json_value_sql = addslashes($json_value); // JSON should be valid, but escape for SQL string context
        $sql_output .= "INSERT INTO GameSetting (game_id, setting_name, setting_value) VALUES ({$game_id_sql_val}, '{$setting_name_sql}', '{$json_value_sql}');\n";
    }
}


echo "\n-- SQL INSERT Statements Generated --\n";
echo $sql_output;
echo "\n-- Game settings migration script finished.\n";

if (!$pdo_new) {
    echo "-- NOTE: No NEW database connection. Game IDs might be placeholders.\n";
}
if (!$games_base_path) {
    echo "-- WARNING: Games base path was not found, SlotSettings.php parsing was skipped.\n";
}

?>
