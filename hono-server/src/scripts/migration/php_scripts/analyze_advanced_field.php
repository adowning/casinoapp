<?php
// analyze_advanced_field.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "-- Analysis Script for 'games.advanced' Field --\n";

// --- Database Connection (Placeholder for OLD DB) ---
function get_old_db_connection() {
    // IMPORTANT: Replace with actual connection details for the OLD database
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
    echo "-- NOTE: Database connection function get_old_db_connection() needs to be implemented to fetch 'advanced' data.\n";
    return null;
}

$pdo_old = get_old_db_connection();

if (!$pdo_old) {
    die("-- CRITICAL: Cannot connect to the old database to analyze 'advanced' field. Please configure the connection in the script. Exiting.\n");
}

$demo_games = ['CreatureFromTheBlackLagoonNET', 'AfricanKingNG'];

echo "\n-- Analyzing 'advanced' field for demo games: " . implode(', ', $demo_games) . " --\n";
echo "-- The output below will show the raw (partial) and unserialized structure of the 'advanced' field.\n";
echo "-- Based on this structure, preliminary migration recommendations are provided.\n";

foreach ($demo_games as $game_name) {
    echo "\n\n======================================================================\n";
    echo "-- Game: {$game_name} --\n";
    echo "======================================================================\n";
    try {
        $stmt = $pdo_old->prepare("SELECT name, advanced FROM games WHERE name = :game_name LIMIT 1");
        $stmt->bindParam(':game_name', $game_name, PDO::PARAM_STR);
        $stmt->execute();
        $game_row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($game_row) {
            if (!empty($game_row['advanced']) && $game_row['advanced'] !== '""' && $game_row['advanced'] !== "''") { // also check for empty string serialization
                echo "Raw 'advanced' field content (first 200 chars): '" . substr($game_row['advanced'], 0, 200) . (strlen($game_row['advanced']) > 200 ? "..." : "") . "'\n\n";

                // Suppress errors during unserialize for analysis, check result instead
                $unserialized_data = @unserialize($game_row['advanced']);

                if ($unserialized_data === false && $game_row['advanced'] !== 'b:0;') { // b:0; is a valid serialization for false
                    echo "Failed to unserialize 'advanced' data. This could be due to:\n";
                    echo "  1. Data is not serialized PHP (e.g., plain JSON, corrupted data).\n";
                    echo "  2. Serialized class definitions are missing (if objects are stored).\n";
                    $last_error = error_get_last();
                    if ($last_error) {
                        echo "  Last PHP error: " . $last_error['message'] . " in " . $last_error['file'] . " on line " . $last_error['line'] . "\n";
                    }
                    echo "  Consider manual inspection of the raw content or specialized unserialize error handling.\n";
                    echo "  Raw content for manual check: " . $game_row['advanced'] . "\n";
                } else {
                    echo "Unserialized 'advanced' data structure:\n";
                    print_r($unserialized_data); // Using print_r for detailed structure
                    echo "\n\n";

                    // --- Preliminary Migration Recommendations ---
                    echo "--- Migration Recommendations for '{$game_name}' (based on observed structure) ---\n";
                    if (is_array($unserialized_data)) {
                        if (empty($unserialized_data)) {
                             echo "  - The 'advanced' field unserialized to an EMPTY array. No data to migrate from here.\n";
                        } else {
                            echo "  - The 'advanced' field is an ARRAY. Analyze its keys and values:\n";
                            foreach ($unserialized_data as $key => $value) {
                                $key_str = is_string($key) ? $key : strval($key);
                                if (is_scalar($value)) {
                                    echo "    - Key '{$key_str}' (Scalar): Value '{$value}'. Likely a game setting. Recommend migrating to 'GameSetting' table with setting_name='{$key_str}' and value as JSON: " . json_encode($value) . "\n";
                                } elseif (is_array($value)) {
                                    echo "    - Key '{$key_str}' (Array): Contains an array. Likely a structured game setting (e.g., list of features, coordinates, specific configs). Recommend migrating to 'GameSetting' with setting_name='{$key_str}' and value as JSON: " . json_encode($value) . "\n";
                                } elseif (is_object($value)) {
                                    echo "    - Key '{$key_str}' (Object): Contains an object of class '" . get_class($value) . "'. This needs careful analysis.\n";
                                    echo "      If it's a simple data object (stdClass or custom DTO), its properties could be migrated to 'GameSetting' (value as JSON of the object) or multiple 'GameSetting' entries if normalized.\n";
                                    echo "      If it's an object with complex behavior or dependencies, it's unlikely to be directly migratable. Evaluate if its *data* is essential for the TS version or if the TS version will re-initialize/re-implement this logic.\n";
                                } elseif (is_null($value)) {
                                     echo "    - Key '{$key_str}' (NULL): Value is NULL. May not need migration unless the presence of the key itself is significant.\n";
                                } else {
                                    echo "    - Key '{$key_str}': Data type (" . gettype($value) . ") is unusual for configuration. Manual review strongly recommended.\n";
                                }
                            }
                        }
                    } elseif (is_object($unserialized_data)) {
                        echo "  - The 'advanced' field is an OBJECT of class '" . get_class($unserialized_data) . "'. This is less common for general settings but possible.\n";
                        echo "    Similar to objects within an array (see above), analyze its properties. If it's a data container, its properties could be mapped to 'GameSetting' entries or one entry with the object as JSON.\n";
                        echo "    If the object has methods or complex internal state tied to PHP, direct migration is unlikely. Focus on extracting essential data.\n";
                    } elseif (is_scalar($unserialized_data)) {
                         echo "  - The 'advanced' field unserialized to a SCALAR value: (" . gettype($unserialized_data) . ") " . var_export($unserialized_data, true) . ".\n";
                         echo "    This is unusual for a field named 'advanced'. If this data is meaningful, recommend migrating to 'GameSetting' with a descriptive setting_name (e.g., 'advanced_scalar_value_{$game_name}') and value as JSON: " . json_encode($unserialized_data) . "\n";
                    } elseif (is_null($unserialized_data) && !empty($game_row['advanced']) && $game_row['advanced'] !== 'N;') { // N; is serialized NULL
                        echo "  - The 'advanced' field unserialized to NULL, but the raw string was not empty or 'N;'. This might indicate an issue with the original serialization or a class that couldn't be found during unserialization.\n";
                        echo "    Manual inspection of the raw string is required: '" . $game_row['advanced'] . "'\n";
                    } else { // Includes null for empty or 'N;'
                        echo "  - The 'advanced' field is empty, NULL, or unserialized to a non-typical type (" . gettype($unserialized_data) . "). No data to migrate or requires manual inspection if raw content was present.\n";
                    }
                    echo "----------------------------------------------------------------------\n";
                }
            } else {
                echo "'advanced' field is empty or NULL in the database for this game.\n";
            }
        } else {
            echo "Game '{$game_name}' not found in the old database.\n";
        }
    } catch (PDOException $e) {
        echo "-- Error fetching 'advanced' data for {$game_name}: " . $e->getMessage() . "\n";
    }
}

echo "\n-- Analysis of 'advanced' field complete. --\n";
echo "-- Review the output above to understand the structure of 'advanced' data for each game.\n";
echo "-- This analysis should inform the actual migration strategy: what to migrate, to where (e.g., GameSetting), and what might be obsolete or require re-implementation in TypeScript.\n";

?>
