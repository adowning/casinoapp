<?php
// migrate_user_sessions.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "-- User Game Session Migration Script --\n";

// --- Database Connection Placeholders ---
function get_old_db_connection() {
    echo "-- NOTE: OLD Database connection function get_old_db_connection() needs to be implemented.\n";
    // See migrate_game_settings.php for an example implementation
    return null;
}

function get_new_db_connection() {
    echo "-- NOTE: NEW Database connection function get_new_db_connection() needs to be implemented.\n";
    // See migrate_reels.php for an example implementation
    return null;
}

function get_new_game_id_by_name($pdo_new, $game_name_candidate) {
    if (!$pdo_new || empty($game_name_candidate)) return null;
    try {
        // This query assumes your 'games' table in the new DB has a 'name' column that matches these game_name_candidates
        $stmt = $pdo_new->prepare("SELECT id FROM games WHERE name = :game_name LIMIT 1");
        $stmt->bindParam(':game_name', $game_name_candidate, PDO::PARAM_STR);
        $stmt->execute();
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($result) {
            return $result['id'];
        } else {
            echo "-- NEW DB: Game_id not found for game name candidate: {$game_name_candidate}\n";
            return null;
        }
    } catch (PDOException $e) {
        echo "-- Error fetching new game_id for {$game_name_candidate} from NEW DB: " . $e->getMessage() . "\n";
        return null;
    }
}

$pdo_old = get_old_db_connection();
$pdo_new = get_new_db_connection();
$sql_output = "";

if (!$pdo_old) {
    die("-- ERROR: Connection to OLD database is required to fetch user sessions. Exiting.\n");
}

// Predefined list of known game names. In a full system, this might be dynamically fetched from the new 'games' table.
// These should match the 'name' field in your new 'games' table.
$known_game_names = ['CreatureFromTheBlackLagoonNET', 'AfricanKingNG'];
// Add more game names here as needed, e.g., 'BookOfRa', 'Columbus', etc.
// It's important these names are accurate and match how they appear as prefixes in session keys.
// Example: if session key is "BookOfRaFreeSpins", "BookOfRa" should be in $known_game_names.
echo "-- Using known game names for prefix matching: " . implode(', ', $known_game_names) . "\n";
if (!$pdo_new) {
    echo "-- WARNING: NEW DB connection not available. Game IDs will be placeholders if matched.\n";
}


// Fetch users from the OLD database
$stmt_old_users = null;
try {
    // Consider fetching in batches for large user bases: add LIMIT and OFFSET
    $query_old_users = "SELECT id, username, session FROM users WHERE session IS NOT NULL AND session != '' AND session != 'N;'";
    $stmt_old_users = $pdo_old->query($query_old_users);
} catch (PDOException $e) {
    die("-- ERROR: Failed to query OLD users table: " . $e->getMessage() . "\n");
}

$user_count = 0;
$total_session_keys_processed = 0;
$total_inserts_generated = 0;

while ($row = $stmt_old_users->fetch(PDO::FETCH_ASSOC)) {
    $user_id = $row['id'];
    $username = $row['username']; // For logging
    $user_session_data_raw = $row['session'];
    $user_count++;

    if (empty($user_session_data_raw) || $user_session_data_raw === 'N;') { // N; is serialized NULL
        // $sql_output .= "-- User ID: {$user_id} ({$username}) - Session data is empty or NULL.\n";
        continue;
    }

    $session_data = @unserialize($user_session_data_raw);

    if ($session_data === false && $user_session_data_raw !== 'b:0;') { // b:0; is serialized false
        $sql_output .= "-- ERROR: Failed to unserialize session for User ID: {$user_id} ({$username}). Raw session (first 100 chars): " . substr($user_session_data_raw, 0, 100) . "\n";
        continue;
    }

    if (!is_array($session_data) || empty($session_data)) {
        // $sql_output .= "-- User ID: {$user_id} ({$username}) - Session unserialized to non-array or empty array.\n";
        continue;
    }

    $sql_output .= "\n-- Processing session for User ID: {$user_id} ({$username})\n";

    foreach ($session_data as $original_key => $value) {
        $total_session_keys_processed++;
        $game_id_for_sql = 'NULL'; // Default to NULL for game_id
        $state_key_for_sql = $original_key;
        $matched_game_name_prefix = null;

        // Attempt to identify game-specific keys by prefix
        foreach ($known_game_names as $game_name_candidate) {
            if (strpos($original_key, $game_name_candidate) === 0) {
                // Ensure it's a meaningful prefix (e.g., not just "Game" if "Game" itself is a game name)
                // And the remainder of the key is not empty or just a separator.
                $potential_state_key = substr($original_key, strlen($game_name_candidate));
                if (!empty($potential_state_key) && preg_match('/^[A-Z_]/', $potential_state_key)) { // Heuristic: remainder starts with Uppercase or underscore
                    $matched_game_name_prefix = $game_name_candidate;
                    $state_key_for_sql = $potential_state_key;

                    $actual_game_id = get_new_game_id_by_name($pdo_new, $matched_game_name_prefix);
                    if ($actual_game_id) {
                        $game_id_for_sql = $actual_game_id;
                    } else {
                        $game_id_for_sql = "'PLACEHOLDER_GAME_ID_FOR_{$matched_game_name_prefix}'"; // Use placeholder if ID not found
                        $sql_output .= "-- WARNING: Using placeholder game_id for matched prefix '{$matched_game_name_prefix}' in key '{$original_key}' for user {$user_id}.\n";
                    }
                    break;
                }
            }
        }

        // Filter out common non-game-state session keys (can be expanded)
        $skip_patterns = ['_token', '_sf_', 'login_', 'flash', 'PHP_AUTH_USER', 'guard_'];
        $should_skip = false;
        foreach ($skip_patterns as $pattern) {
            if (strpos($original_key, $pattern) !== false) {
                // $sql_output .= "-- Skipping generic session key: '{$original_key}' for user_id: {$user_id}\n";
                $should_skip = true;
                break;
            }
        }
        if ($should_skip) {
            continue;
        }

        // Filter out keys that don't seem like game state (e.g. short, non-descriptive)
        // This is subjective and needs refinement based on actual session data.
        // For example, if not matched to a game and key is very generic.
        if ($game_id_for_sql === 'NULL' && strlen($original_key) < 5 && !is_array($value)) {
             // $sql_output .= "-- Skipping potentially generic session key (too short, no game match): '{$original_key}' for user_id: {$user_id}\n";
             // continue;
        }

        // Special handling for 'timelife' often found in SlotSettings gameData structure
        if ($original_key === 'timelife' && is_array($value) && isset($value['payload']) && isset($value['timelife'])) {
            // This looks like the wrapper structure from SlotSettings itself, we want the payload.
            // This case might be too specific or might indicate the top-level key was the game name.
            // For now, let's assume if such a structure is found, the $original_key was the game name.
            // This part of logic is complex and depends heavily on how SlotSettings stores data in session.
            // The current loop processes $session_data which is the *user's entire session*.
            // If a game stores its data under a key like $game_name in user session, then $value here would be that game's session array.
            // Example: $session_data['CreatureFromTheBlackLagoonNET'] = ['FreeGames' => 10, 'timelife' => ['payload' => ..., 'timelife' => ...]]
            // The current prefix logic should handle $session_data['CreatureFromTheBlackLagoonNETFreeGames'] directly.
            // This 'timelife' check might be redundant if keys are specific enough.
        }


        $state_value_json = json_encode($value);
        if ($state_value_json === false) {
            $sql_output .= "-- ERROR: Failed to JSON encode value for key '{$original_key}' (User ID: {$user_id}). Error: " . json_last_error_msg() . ". Value: " . print_r($value, true) . "\n";
            continue;
        }

        $state_key_sql = addslashes($state_key_for_sql);
        $state_value_json_sql = addslashes($state_value_json);

        // Construct game_id part of SQL carefully if it's a placeholder string vs. integer vs. NULL
        $game_id_sql_insert_val = ($game_id_for_sql === 'NULL' || is_null($game_id_for_sql)) ? 'NULL' : (is_int($game_id_for_sql) ? $game_id_for_sql : $game_id_for_sql); // Placeholder will be quoted string

        $sql_output .= "INSERT INTO UserGameState (user_id, game_id, state_key, state_value) VALUES ({$user_id}, {$game_id_sql_insert_val}, '{$state_key_sql}', '{$state_value_json_sql}');\n";
        $total_inserts_generated++;
    }
}

echo "\n-- User Game Session Migration Processing Summary --\n";
echo "Total users checked: {$user_count}\n";
echo "Total session keys encountered (pre-filter): {$total_session_keys_processed}\n";
echo "Total INSERT statements generated for UserGameState: {$total_inserts_generated}\n";

echo "\n-- SQL INSERT Statements Generated --\n";
echo $sql_output;
echo "\n-- User Game Session migration script finished.\n";

if (!$pdo_old) echo "-- WARNING: OLD DB connection was not available. No data processed.\n";
if (!$pdo_new) echo "-- WARNING: NEW DB connection not available. Game IDs are placeholders if game names were matched from the known list.\n";
echo "-- Review generated SQL carefully. Test thoroughly before applying to production.\n";
echo "-- Consider expanding 'known_game_names' list and refining key parsing/filtering logic.\n";

?>
