<?php
// migrate_core_tables.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "-- Core Table Data Migration Script --\n";
echo "-- IMPORTANT: Review and test this script thoroughly on a staging environment first.\n";
echo "-- Ensure the new database schema is created before running the generated SQL.\n";
echo "-- This script assumes you might want to preserve original IDs. If your new tables use auto-incrementing IDs\n";
echo "-- and you don't set them explicitly, you'll need to adjust or handle ID mapping for relations.\n";
echo "-- For simplicity, it tries to insert with original IDs. Ensure your new table definitions allow this if intended (e.g., no auto_increment on PK or temporarily disable it).\n";


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
    $options = [ PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_STRINGIFY_FETCHES => false ];
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

// PDO connection to the NEW database (optional, mainly for checks or complex FK mapping not done here)
function get_new_db_connection() {
    echo "-- NOTE: NEW Database connection function get_new_db_connection() is not strictly used by this script for inserts, but placeholder is here.\n";
    return null;
}

$pdo_old = get_old_db_connection();
// $pdo_new = get_new_db_connection(); // Not used for inserts in this version

if (!$pdo_old) {
    die("-- ERROR: Connection to OLD database is required. Exiting.\n");
}

$sql_output = "";

// Helper function for formatting values for SQL INSERT
function format_sql_value($value) {
    if ($value === null) {
        return "NULL";
    }
    if (is_string($value)) {
        // Basic escaping, for more robust solution use PDO prepared statements if executing directly
        return "'" . addslashes($value) . "'";
    }
    if (is_bool($value)) {
        return $value ? "1" : "0";
    }
    return $value; // Numbers
}

$sql_output .= "SET FOREIGN_KEY_CHECKS=0;\n\n";

// --- 1. User Migration (`users` table) ---
try {
    $sql_output .= "-- Migrating Users --\n";
    $stmt = $pdo_old->query("SELECT id, username, email, password, balance, shop_id, currency, status, is_blocked, created_at, updated_at, total_in, total_out, count_balance, rating, avatar, language, phone, phone_verified, sms_token, sms_token_date, inviter_id, parent_id, auth_token, last_login, last_online, last_daily_entry, last_progress, last_wheelfortune, shop_limit, google2fa_secret, google2fa_enable, agreed, free_demo, role_id FROM users");

    $user_fields = [
        'id', 'username', 'email', 'password', 'balance', 'shop_id', 'currency', 'status', 'is_blocked',
        'created_at', 'updated_at', 'total_in', 'total_out', 'count_balance', 'rating', 'avatar', 'language',
        'phone', 'phone_verified', 'sms_token', 'sms_token_date', 'inviter_id', 'parent_id', 'auth_token',
        'last_login', 'last_online', 'last_daily_entry', 'last_progress', 'last_wheelfortune', 'shop_limit',
        'google2fa_secret', 'google2fa_enable', 'agreed', 'free_demo', 'role_id'
        // Excluded: session (handled by migrate_user_sessions.php)
        // Excluded: remember_token (often session-related, Prisma has it but might not need direct migration)
        // Excluded bonus value fields like 'tournaments', 'happyhours' etc. as they are often results of calculations or states.
        // The Prisma schema added them, so if they are direct values in old DB, they can be added here.
        // For now, focusing on core identity and direct balance/config fields from PHP User fillable.
    ];
    $sql_output .= "INSERT INTO User (" . implode(', ', $user_fields) . ") VALUES \n";
    $user_rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $values = [];
        foreach($user_fields as $field) {
            $values[] = format_sql_value(isset($row[$field]) ? $row[$field] : null);
        }
        $user_rows[] = "(" . implode(', ', $values) . ")";
    }
    if (!empty($user_rows)) {
        $sql_output .= implode(",\n", $user_rows) . ";\n";
    } else {
        $sql_output .= "-- No users found or an error occurred.\n";
    }
    $sql_output .= "\n";

} catch (PDOException $e) {
    $sql_output .= "-- ERROR migrating users: " . $e->getMessage() . "\n\n";
}


// --- 2. Shop Migration (`shops` table) ---
try {
    $sql_output .= "-- Migrating Shops --\n";
    $stmt = $pdo_old->query("SELECT id, name, percent, is_blocked, currency, max_win, created_at, updated_at FROM shops");

    $shop_fields = ['id', 'name', 'percent', 'is_blocked', 'currency', 'max_win', 'created_at', 'updated_at'];
    $sql_output .= "INSERT INTO Shop (" . implode(', ', $shop_fields) . ") VALUES \n";
    $shop_rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $values = [];
        foreach($shop_fields as $field) {
            $values[] = format_sql_value(isset($row[$field]) ? $row[$field] : null);
        }
        $shop_rows[] = "(" . implode(', ', $values) . ")";
    }
     if (!empty($shop_rows)) {
        $sql_output .= implode(",\n", $shop_rows) . ";\n";
    } else {
        $sql_output .= "-- No shops found or an error occurred.\n";
    }
    $sql_output .= "\n";

} catch (PDOException $e) {
    $sql_output .= "-- ERROR migrating shops: " . $e->getMessage() . "\n\n";
}


// --- 3. Games Migration (`games` table - Core Fields) ---
try {
    $sql_output .= "-- Migrating Games (Core Fields) --\n";
    // Select only core fields. Config fields (bet, denomination string, jp_percents, etc.) are handled by migrate_game_settings.
    $stmt = $pdo_old->query("SELECT id, name, title, shop_id, view, stat_in, stat_out, bids, label, device, original_id, created_at, updated_at FROM games");

    $game_fields = ['id', 'name', 'title', 'shop_id', 'view', 'stat_in', 'stat_out', 'bids', 'label', 'device', 'original_id', 'created_at', 'updated_at'];
    $sql_output .= "INSERT INTO Game (" . implode(', ', $game_fields) . ") VALUES \n";
    $game_rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $values = [];
        foreach($game_fields as $field) {
            $values[] = format_sql_value(isset($row[$field]) ? $row[$field] : null);
        }
        $game_rows[] = "(" . implode(', ', $values) . ")";
    }
    if (!empty($game_rows)) {
        $sql_output .= implode(",\n", $game_rows) . ";\n";
    } else {
        $sql_output .= "-- No games found or an error occurred.\n";
    }
    $sql_output .= "\n";

} catch (PDOException $e) {
    $sql_output .= "-- ERROR migrating games: " . $e->getMessage() . "\n\n";
}


// --- 4. GameBank Migration (`game_banks` table) ---
// This assumes old structure is a table named 'game_banks' with these fields.
// Adjust if old structure is different (e.g. columns on 'shops' or 'games').
try {
    $sql_output .= "-- Migrating GameBanks --\n";
    // Check if old game_banks table exists. This is a common pattern.
    // If game banks are part of shop table in old DB, query would be different.
    // For this example, assuming a separate 'game_banks' table similar to new schema.
    $stmt = $pdo_old->query("SELECT id, shop_id, slots, bonus, table_bank, little, created_at, updated_at FROM game_banks");

    $gamebank_fields = ['id', 'shop_id', 'slots', 'bonus', 'table_bank', 'little', 'created_at', 'updated_at'];
    $sql_output .= "INSERT INTO GameBank (" . implode(', ', $gamebank_fields) . ") VALUES \n";
    $gamebank_rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $values = [];
        foreach($gamebank_fields as $field) {
            $values[] = format_sql_value(isset($row[$field]) ? $row[$field] : null);
        }
        $gamebank_rows[] = "(" . implode(', ', $values) . ")";
    }
    if (!empty($gamebank_rows)) {
        $sql_output .= implode(",\n", $gamebank_rows) . ";\n";
    } else {
        $sql_output .= "-- No game_banks found or table might not exist with this structure in old DB. Manual check needed for source data.\n";
    }
    $sql_output .= "\n";

} catch (PDOException $e) {
    $sql_output .= "-- ERROR migrating game_banks (or table not found/schema mismatch): " . $e->getMessage() . ". Please verify old DB structure.\n\n";
}

// --- 5. JPG (Jackpot) Migration (`jpgs` table) ---
try {
    $sql_output .= "-- Migrating Jackpots (JPGs) --\n";
    // Assuming old 'jpgs' table. The Prisma schema has an optional 'game_id' for JPG.
    // If old DB 'jpgs' table doesn't have 'game_id', it will be NULL.
    // Need to check if old 'jpgs' table has a 'game_id' column. For now, assume it does not for broader compatibility.
    $stmt = $pdo_old->query("SELECT id, shop_id, name, balance, percent, user_id, pay_sum, start_balance, created_at, updated_at FROM jpgs");

    $jpg_fields = ['id', 'shop_id', 'name', 'balance', 'percent', 'user_id', 'pay_sum', 'start_balance', 'created_at', 'updated_at'];
    // If your old jpgs table has a game_id, add it to $jpg_fields and the query.
    // e.g., $jpg_fields = [... , 'game_id'];
    $sql_output .= "INSERT INTO JPG (" . implode(', ', $jpg_fields) . ") VALUES \n";
    $jpg_rows = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $values = [];
         foreach($jpg_fields as $field) {
            $values[] = format_sql_value(isset($row[$field]) ? $row[$field] : null);
        }
        $jpg_rows[] = "(" . implode(', ', $values) . ")";
    }
    if (!empty($jpg_rows)) {
        $sql_output .= implode(",\n", $jpg_rows) . ";\n";
    } else {
        $sql_output .= "-- No JPGs found or an error occurred.\n";
    }
    $sql_output .= "\n";

} catch (PDOException $e) {
    $sql_output .= "-- ERROR migrating JPGs: " . $e->getMessage() . "\n\n";
}


$sql_output .= "SET FOREIGN_KEY_CHECKS=1;\n";

echo "\n-- SQL INSERT Statements Generated --\n";
echo $sql_output;
echo "\n-- Core table migration script finished.\n";
echo "-- Remember to handle password hashing compatibility for users (e.g., ensure new system can verify old hashes or plan for password resets).\n";
echo "-- If preserving IDs, ensure new tables are prepared for explicit ID insertion (e.g., `SET IDENTITY_INSERT ON` for SQL Server, or no auto-increment on PK columns during these inserts for MySQL).\n";

?>
