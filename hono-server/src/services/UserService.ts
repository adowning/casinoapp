import { PrismaClient, User }
// Assuming Prisma client is in a standard generated location
// Adjust if your project structure for generated client is different
from '../generated/prisma';

const prisma = new PrismaClient();

export interface UpdateUserBalanceArgs {
  userId: number;
  amount: number; // Positive for credit, negative for debit from main balance perspective.
  transactionType: string; // e.g., 'spin_bet', 'spin_win', 'bonus_win', 'manual_deposit', 'refund'
  // Consider adding other relevant fields from PHP's addBalance context if needed for logic:
  // payeerId?: number;
  // systemName?: string; // 'handpay', 'invite', 'progress', 'tournament', 'daily_entry', 'refund', etc.
  // isBonusPayout?: boolean; // To distinguish if 'amount' is a bonus that should affect specific bonus counters
  // bonusWager?: number; // If a bonus has a wager requirement for count_bonus_type fields
}

async function getUserById(userId: number): Promise<User | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    return user;
  } catch (error) {
    console.error(`[UserService] Error fetching user ${userId}:`, error);
    // Consider throwing a custom error or returning a specific error object for consumers to handle
    // For now, re-throwing or returning null are options. Let's return null for simplicity.
    return null;
  }
}

async function getUserBalance(userId: number): Promise<number | null> {
  const user = await getUserById(userId);
  // User.balance is Float, Prisma maps this to number.
  return user ? user.balance : null;
}

/**
 * Updates a user's balance and related financial counters.
 * This is a complex operation aiming to mirror parts of PHP User::addBalance and User::updateCountBalance.
 *
 * IMPORTANT NOTES & TODOs:
 * - This is an initial, simplified port. Many side-effects from the PHP version are NOT YET IMPLEMENTED.
 * - TODO: Implement detailed bonus counter logic from PHP `User::updateCountBalance`
 *   (e.g., debiting `count_tournaments`, `count_happyhours` before main balance if applicable for the transaction type).
 * - TODO: Replicate PHP `User::addBalance` side-effects:
 *   - Shop balance checks and updates (if applicable).
 *   - OpenShift interactions (if manual cashier operations are involved).
 *   - HappyHour multipliers.
 *   - Refund calculations and updates to `user.refunds`.
 *   - User level/progress updates (e.g., interactions with WBLib, Progress systems).
 * - TODO: Handle password hash compatibility or re-hash strategy if user creation/updates involve passwords.
 * - TODO: Implement role and permission checks, especially for manual balance adjustments.
 * - TODO: Transaction logging needs to be integrated with a dedicated LogService.
 * - TODO: The logic for `count_balance` accumulation based on `transactionType` (or `systemName` from PHP) needs careful mapping.
 * - TODO: Consider atomicity for complex operations that might involve multiple related updates (e.g. user level, shop balance).
 *         Prisma's $transaction is used here for user updates, but broader operations might need more.
 */
async function updateUserBalance(args: UpdateUserBalanceArgs): Promise<User | null> {
  const { userId, amount, transactionType } = args;

  // Using a Prisma transaction to ensure atomicity of reads and writes to the user record.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      // It's often better to throw an error that can be caught by the caller.
      console.error(`[UserService] User with ID ${userId} not found for balance update.`);
      throw new Error(`User with ID ${userId} not found.`);
    }

    // Initialize with current values, handling potential nulls from Prisma types (though defaults should prevent this for numbers)
    let newBalance = user.balance ?? 0;
    let newCountBalance = user.count_balance ?? 0;
    let newTotalIn = user.total_in ?? 0;
    let newTotalOut = user.total_out ?? 0;

    // --- Simplified logic inspired by PHP User::updateCountBalance for debits ---
    // This part handles how debits consume various "count" balances before hitting the main balance.
    // The full PHP logic is more complex and iterates through multiple specific bonus counters.
    let debitAmount = 0;
    if (amount < 0) {
        debitAmount = Math.abs(amount);

        // 1. Try to cover debit from `count_balance`
        if (newCountBalance > 0) {
            const fromCountBalance = Math.min(debitAmount, newCountBalance);
            newCountBalance -= fromCountBalance;
            debitAmount -= fromCountBalance;
        }

        // TODO: PHP iterates through various bonus counters here (count_tournaments, count_happyhours, etc.)
        // This is a placeholder for that more complex logic.
        // For now, any remaining debitAmount after count_balance will be applied to the main balance.
        // Example: if (debitAmount > 0 && user.count_tournaments > 0) { ... }
    }

    // --- Update main balance ---
    if (amount < 0) { // Debit
        newBalance -= debitAmount; // Debit what's left from main balance
    } else { // Credit
        newBalance += amount;
    }

    // Optional: Check for negative balance if system rules disallow it.
    // The original PHP code has a User::saved hook that resets bonus counters if balance <= 0 and refunds <= 0.
    // Replicating this hook behavior directly in a service method requires careful consideration.
    if (newBalance < 0) {
      // console.warn(`[UserService] User ${userId} balance is now negative: ${newBalance}. Depending on rules, this might be an issue or trigger other logic.`);
      // For now, allow it, as PHP might temporarily allow it before correction/checks.
    }

    // --- Update total_in, total_out ---
    if (amount > 0) {
      newTotalIn += amount;
    } else { // amount < 0
      newTotalOut += Math.abs(amount); // Use the original absolute debit amount for total_out
    }

    // --- Update count_balance (general financial activity accumulator) ---
    // PHP `addBalance` increments `count_balance` for most non-bonus system transactions using the absolute sum.
    // `this->increment('count_balance', abs($summ));`
    // It's an accumulator of "wagerable" money or general turnover, not a direct reflection of main balance changes for bonuses.
    // If 'amount' is from a bonus system that has its own `count_xxx` field, PHP logic usually increments that specific counter instead of `count_balance`.
    // This needs a mapping from `transactionType` to the PHP `system` variable logic.
    // For a simplified start: assume general transactions affect count_balance with the absolute amount.
    // Specific bonus payouts (e.g. 'invite_bonus_payout') might set their own `count_invite` instead.
    const generalTransactionTypes = ['spin_bet', 'spin_win', 'manual_deposit', 'manual_withdrawal']; // Example
    if (generalTransactionTypes.includes(transactionType)) {
        newCountBalance += Math.abs(amount); // PHP uses abs value here.
    }
    // If it's a debit that was partially covered by bonus counters, `count_balance` might have already been reduced.
    // The PHP logic is `if (!isset(BONUS_SYSTEMS[$system])) { user->increment('count_balance', abs(amount)) }`
    // and then `updateCountBalance` is called for debits.
    // The current `newCountBalance` already reflects reductions if `amount < 0`.
    // If `amount > 0` (credit), then it should increment.
    // This part is tricky to map directly without the $system variable context.
    // Let's refine: if it's a credit and a general type, add. If debit, it was handled above.
    if (amount > 0 && generalTransactionTypes.includes(transactionType)) {
        // newCountBalance was already updated if amount < 0.
        // If amount > 0, this makes it newCountBalance += amount.
        // This seems more aligned with how PHP might handle credits to count_balance
    }
    if (newCountBalance < 0) newCountBalance = 0; // Ensure count_balance doesn't go negative.

    // --- Update user record in the database ---
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        balance: parseFloat(newBalance.toFixed(4)), // Ensure precision, matching PHP float behavior
        count_balance: parseFloat(newCountBalance.toFixed(4)),
        total_in: parseFloat(newTotalIn.toFixed(4)),
        total_out: parseFloat(newTotalOut.toFixed(4)),
        // TODO: Update specific bonus counters (e.g., user.tournaments, user.count_tournaments)
        // This would depend on `args.systemName` or a more detailed `transactionType`.
        // Example: if (args.systemName === 'tournament' && args.isBonusPayout) { data.tournaments = user.tournaments + amount; data.count_tournaments = user.count_tournaments + (amount * args.bonusWager); }
        last_bid: new Date(), // Mirroring PHP's `last_bid` update on balance changes from `addBalance`.
      },
    });

    // --- Transaction Logging Placeholder ---
    // TODO: Await LogService.logUserTransaction({ userId, transactionType, amount, oldBalance: user.balance, newBalance: updatedUser.balance, ...otherDetails });
    console.log(`[UserService] User balance updated: UserID=${userId}, Type=${transactionType}, Amount=${amount}, NewBalance=${updatedUser.balance}`);

    // --- Post-update logic (like PHP User::saved hook) ---
    // Example: If balance is zero and refunds are zero, PHP resets all bonus counters.
    // This would require another update operation within the transaction if implemented here.
    // if (updatedUser.balance <= 0 && (updatedUser.refunds ?? 0) <= 0) {
    //   console.warn(`[UserService] User ${userId} balance is <= 0 and refunds are <=0. PHP logic would reset bonus counters.`);
    //   // await tx.user.update({ where: { id: userId }, data: { count_tournaments: 0, ... } });
    // }

    return updatedUser;
  });
}

// Encapsulate functions in a service object or class
export const UserService = {
  getUserById,
  getUserBalance,
  updateUserBalance,
};

// Example of using a class if preferred:
// export class UserServiceClass {
//   private prisma: PrismaClient;
//   constructor() {
//     this.prisma = new PrismaClient();
//   }
//   async getUserById(userId: number): Promise<User | null> { /* ... */ }
//   async getUserBalance(userId: number): Promise<number | null> { /* ... */ }
//   async updateUserBalance(args: UpdateUserBalanceArgs): Promise<User | null> { /* ... */ }
// }
// export const UserServiceProvider = new UserServiceClass();
