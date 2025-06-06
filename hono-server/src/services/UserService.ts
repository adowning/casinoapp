import { PrismaClient, User }
// Assuming Prisma client is in a standard generated location
// Adjust if your project structure for generated client is different
from '../generated/prisma';

const prisma = new PrismaClient();

export interface UpdateUserBalanceArgs {
  userId: number;
  amount: number; // Positive for credit, negative for debit.
  transactionType: string; // General category like 'spin_bet', 'spin_win', 'bonus_payout'

  // Fields to mirror context of PHP User::addBalance and its callers
  systemName?: string; // Crucial: 'handpay', 'invite', 'progress', 'tournament', 'daily_entry', 'refund', 'welcome_bonus', 'sms_bonus', 'wheelfortune', 'happyhour' etc.
  isDirectDebit?: boolean; // True if this is a direct debit that should try to consume bonus counters first (like a withdrawal)
  isBonusCredit?: boolean; // True if 'amount' is a bonus being credited, to update specific bonus value fields
  wagerForCount?: number;  // Wager multiplier for count_bonus_field
  specificBonusField?: keyof User; // Typed key for bonus field 'invite', 'progress', etc.
  // shopId?: number; // For shop balance checks - defer full implementation
  // payeerId?: number; // For logging - defer to LogService call
  // refundPercentage?: number; // If 'systemName' is 'handpay' and a refund needs to be calculated.
}

// Define the order of bonus counters to be debited, matching PHP logic if possible
const bonusCounterFields: (keyof User)[] = [
  // Order matters if PHP has a specific debit order
  'count_tournaments', 'count_happyhours', 'count_refunds', 'count_progress',
  'count_daily_entries', 'count_invite', 'count_welcomebonus',
  'count_smsbonus', 'count_wheelfortune'
];


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
  const { userId, amount, transactionType, systemName, isDirectDebit, isBonusCredit, wagerForCount, specificBonusField } = args;

  // Using a Prisma transaction to ensure atomicity of reads and writes to the user record.
  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
        // It's often better to throw an error that can be caught by the caller.
        console.error(`[UserService] User with ID ${userId} not found for balance update.`);
        throw new Error(`User with ID ${userId} not found.`);
    }


    // Initialize values from user, defaulting nulls to 0 for calculation
    let currentBalance = user.balance ?? 0;
    let currentCountBalance = user.count_balance ?? 0;
    let currentTotalIn = user.total_in ?? 0;
    let currentTotalOut = user.total_out ?? 0;
    let currentRefunds = user.refunds ?? 0;

    // Initialize bonus value fields from user object
    let bonusSpecificValue: number = 0;
    if (specificBonusField && user.hasOwnProperty(specificBonusField) && typeof user[specificBonusField] === 'number') {
        bonusSpecificValue = user[specificBonusField] as number;
    }

    let bonusSpecificCount: number = 0;
    const countFieldName = specificBonusField ? ('count_' + specificBonusField) as keyof User : null;
    if (countFieldName && user.hasOwnProperty(countFieldName) && typeof user[countFieldName] === 'number') {
        bonusSpecificCount = user[countFieldName] as number;
    }

    // user.address in Prisma is String?. PHP User uses it for some bonus accumulations.
    let currentAddressAsNumber = parseFloat(user.address || '0.0') || 0.0;

    if (amount === 0 && !systemName) {
        console.warn(`[UserService] updateUserBalance called with amount 0 for user ${userId} and no systemName. No balance changes will occur.`);
        return user; // No change if amount is 0 and no specific system action implies other changes
    }

    const updateData: Partial<User> = {}; // Collect all updates here

    if (amount < 0) { // Processing a DEBIT
      let debitAmount = Math.abs(amount);
      currentTotalOut += debitAmount; // Accumulate total out with the original absolute debit amount

      // isDirectDebit typically true for withdrawals or manual admin actions
      // systemName === 'handpay' (for type 'out') is also a withdrawal type in PHP
      const isWithdrawalLike = isDirectDebit || (systemName === 'handpay' && transactionType === 'withdrawal'); // transactionType needs to be passed or inferred

      if (isWithdrawalLike) {
        // 1. Consume count_balance
        if (currentCountBalance > 0) {
          const fromCountBalance = Math.min(debitAmount, currentCountBalance);
          currentCountBalance -= fromCountBalance;
          debitAmount -= fromCountBalance;
        }
        // 2. Consume specific bonus counters
        if (debitAmount > 0) {
          for (const field of bonusCounterFields) {
            if (user.hasOwnProperty(field)) {
                let bonusCountVal = (user[field] as number | null) ?? 0;
                if (bonusCountVal > 0) {
                    const fromThisCounter = Math.min(debitAmount, bonusCountVal);
                    updateData[field] = parseFloat((bonusCountVal - fromThisCounter).toFixed(4));
                    debitAmount -= fromThisCounter;
                    if (debitAmount === 0) break;
                } else {
                    updateData[field] = 0; // Ensure it's set if null and iterated over
                }
            }
          }
        }
        // 3. Any remaining debit comes from main balance
        currentBalance -= debitAmount;
        // 4. Reset refunds on withdrawal-like debits (mirroring PHP User::addBalance)
        currentRefunds = 0;
      } else { // General debit (e.g. spin bet, not a direct withdrawal of funds)
        // Main balance is directly affected by the full amount.
        currentBalance -= debitAmount;
        // count_balance reduction for general debits (like bets) should reflect the amount bet.
        // If a win occurs, count_balance will be increased by the win amount.
        // This makes count_balance reflect general turnover for non-bonus activities.
        currentCountBalance -= debitAmount; // Reduce count_balance by the bet amount
      }
    } else if (amount > 0) { // Processing a CREDIT
      currentTotalIn += amount;

      if (isBonusCredit && specificBonusField && user.hasOwnProperty(specificBonusField)) {
        // This is a specific bonus payout
        bonusSpecificValue += amount;
        updateData[specificBonusField] = parseFloat(bonusSpecificValue.toFixed(4));

        if (countFieldName && user.hasOwnProperty(countFieldName)) {
            bonusSpecificCount += (amount * (wagerForCount || 1));
            updateData[countFieldName] = parseFloat(bonusSpecificCount.toFixed(4));
        }
        currentAddressAsNumber += amount; // PHP adds bonus to 'address' field

        // Some bonuses might also directly add to main balance, others might not.
        // PHP 'addBalance' for bonuses often updates specific bonus field AND main balance.
        currentBalance += amount;
      } else if (systemName === 'refund') {
        currentRefunds += amount;
        // Refunds in PHP also add to main balance.
        currentBalance += amount;
        // Refunds also contribute to count_balance in PHP if wager is applicable
        currentCountBalance += amount * (wagerForCount ?? 1); // Assuming refund might have a wager component for its count
      }
      else { // General credit (e.g. spin win, or manual deposit if systemName='handpay')
        currentBalance += amount;

        // General deposits/wins usually affect count_balance.
        // PHP: if (!BONUS_SYSTEM_COUNTERS_MAP.has(systemName)) { user.count_balance += amount; }
        const nonCountBalanceAffectingSystems = ['invite', 'progress', 'tournament', 'daily_entry', 'happyhour', 'refund', 'welcome_bonus', 'sms_bonus', 'wheelfortune'];
        if (!systemName || !nonCountBalanceAffectingSystems.includes(systemName)) {
            currentCountBalance += amount;
        }

        // Placeholder for PHP refund calculation on credit (e.g. from handpay deposit)
        // Actual refund calculation in PHP (Lib\Functions::refunds) is complex.
        if (systemName === 'handpay' && user.shop_id !== null) {
            // const shop = await tx.shop.findUnique({where: {id: user.shop_id}, select: {percent: true}});
            // const shopPercent = shop?.percent ?? 0; // This is shop's general percent, not necessarily refund rate
            // const calculatedRefund = amount * (args.refundPercentage ?? (shopPercent / 100)); // Needs defined refund rate
            // currentRefunds += calculatedRefund;
            // console.log(`[UserService] Placeholder for refund calculation on handpay credit for user ${userId}. Amount: ${amount}`);
        }
      }
    }

    // Ensure count_balance is not negative after all operations
    if (currentCountBalance < 0) currentCountBalance = 0;

    // Assign final calculated values to updateData
    updateData.balance = parseFloat(currentBalance.toFixed(4));
    updateData.count_balance = parseFloat(currentCountBalance.toFixed(4));
    updateData.total_in = parseFloat(currentTotalIn.toFixed(4));
    updateData.total_out = parseFloat(currentTotalOut.toFixed(4));
    updateData.refunds = parseFloat(currentRefunds.toFixed(4));
    updateData.address = currentAddressAsNumber.toString();
    updateData.last_bid = new Date();


    user = await tx.user.update({
      where: { id: userId },
      data: updateData,
    });

    // Post-update logic (simulating PHP 'saved' hook for resetting bonus counters)
    if (user.balance <= 0 && (user.refunds ?? 0) <= 0) {
      console.warn(`[UserService] User ${userId} balance and refunds are zero or less. PHP logic would reset all bonus count_* and value fields. Implementing this reset.`);
      const resetData: Partial<User> = {};
      bonusCounterFields.forEach(field => {
        if (user.hasOwnProperty(field)) resetData[field] = 0;
      });
      // Also reset corresponding value fields if they exist (e.g. 'tournaments' for 'count_tournaments')
      const bonusValueFields: (keyof User)[] = ['tournaments', 'happyhours', 'progress', 'daily_entries', 'invite', 'welcomebonus', 'smsbonus', 'wheelfortune'];
      bonusValueFields.forEach(field => {
        if (user.hasOwnProperty(field)) resetData[field] = 0;
      });
      // 'refunds' is already captured and part of the condition.
      // 'address' (bonus_balance_no_wager) might also be reset by PHP here.

      if (Object.keys(resetData).length > 0) {
        user = await tx.user.update({ where: { id: userId }, data: resetData });
        console.log(`[UserService] User ${userId} bonus counters and values have been reset due to zero balance/refunds.`);
      }
    }

    // TODO: Transaction Logging via LogService:
    // await LogService.logTransaction({ userId, transactionType, systemName, amount: args.amount, oldBalance: originalUserBalance, newBalance: user.balance, ...otherDetails });

    return user;
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
