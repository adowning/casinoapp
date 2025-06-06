<?php
// migrate_reels.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "-- Reel Strip Migration Script --\n";

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
        // echo "-- DB connection not available, cannot fetch game_id for {$game_name}.\n";
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

// Path to the Games directory, assuming this script is in hono-server/src/scripts/migration/php_scripts/
// and Games directory is at the root of the project.
$games_base_path = __DIR__ . '/../../../../../../Games/';
$games_base_path = realpath($games_base_path); // Resolve to absolute path

echo "-- Looking for Games directory at: " . ($games_base_path ? $games_base_path : "Path not found") . "\n";
echo "-- Before running for real, ensure the 'games' table in the new database is populated with game names and their corresponding IDs.\n";

$pdo = get_new_db_connection();

if (!$games_base_path || !is_dir($games_base_path)) {
    die("-- ERROR: Games directory not found. Please check the path: " . $games_base_path . "\n");
}

$game_directories = new DirectoryIterator($games_base_path);
$sql_output = "";

foreach ($game_directories as $fileinfo) {
    if ($fileinfo->isDir() && !$fileinfo->isDot()) {
        $game_name = $fileinfo->getFilename();
        $reels_file = $fileinfo->getPathname() . '/reels.txt';

        if (!file_exists($reels_file)) {
            $sql_output .= "-- Reels file not found for game: {$game_name} (skipped)\n";
            continue;
        }

        $sql_output .= "\n-- Processing game: {$game_name}\n";
        $game_id = null;
        if ($pdo) {
            $game_id = get_game_id_by_name($pdo, $game_name);
        }

        $game_id_for_sql = $game_id ?: "PLACEHOLDER_GAME_ID_FOR_{$game_name}";
        if (!$game_id && $pdo) {
             $sql_output .= "-- WARNING: Could not find game_id for {$game_name}. Using placeholder in SQL.\n";
        }


        $lines = file($reels_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            $sql_output .= "-- Could not read reels file for game: {$game_name}\n";
            continue;
        }

        foreach ($lines as $line_number => $line) {
            $line = trim($line);
            if (empty($line)) continue;

            $parts = explode('=', $line, 2);
            if (count($parts) !== 2) {
                $sql_output .= "-- Invalid format in {$game_name}/reels.txt on line " . ($line_number + 1) . ": {$line} (skipped)\n";
                continue;
            }

            $strip_name = trim($parts[0]);
            $symbols_str = trim($parts[1]);
            $symbols_array = array_map('trim', explode(',', $symbols_str));

            // Ensure symbols are strings, as json_encode might convert numeric strings to numbers
            $symbols_array_as_strings = array_map('strval', $symbols_array);
            $symbols_json = json_encode($symbols_array_as_strings);

            if ($symbols_json === false) {
                $sql_output .= "-- Failed to JSON encode symbols for {$strip_name} in game {$game_name} on line " . ($line_number + 1) . ". Error: " . json_last_error_msg() . " (skipped)\n";
                continue;
            }

            // Prepare values for SQL: PDO would handle escaping if executing directly. For generating SQL files, basic escaping.
            // Using addslashes for simplicity here, but prepared statements are king.
            $strip_name_sql = addslashes($strip_name);
            $symbols_json_sql = addslashes($symbols_json); // JSON should be mostly fine, but good practice if embedding in SQL string.
            $game_id_sql_val = is_int($game_id_for_sql) ? $game_id_for_sql : "'{$game_id_for_sql}'";


            $sql_output .= "INSERT INTO GameReelStrip (game_id, strip_name, symbols) VALUES ({$game_id_sql_val}, '{$strip_name_sql}', '{$symbols_json_sql}');\n";
        }
    }
}

echo "\n-- SQL INSERT Statements Generated --\n";
echo $sql_output;
echo "\n-- Reel strip migration script finished.\n";

if (!$pdo) {
    echo "-- NOTE: No database connection was established. SQL statements are generated with placeholders if game_ids could not be determined via DB lookup.\n";
    echo "-- Ensure placeholder game_ids are replaced and database connection is properly configured before execution against the database.\n";
}

?>
