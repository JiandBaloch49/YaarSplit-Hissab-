// format.js — turning values into the text shown on screen (and rupee text
// typed by the user back into numbers).
//
// Pure functions like split.js: plain values in, plain values out.
// Money is always whole rupees (integers), never decimals.

/**
 * Show a whole-rupee amount, e.g. 1200 → "Rs 1,200".
 * Negative amounts are shown without the minus sign; the screen decides how
 * to say "owes" vs "gets".
 */
export function formatRupees(amount) {
  return `Rs ${addCommas(String(Math.abs(amount)))}`;
}

// Put a comma before every group of 3 digits from the right:
// "1200000" → "1,200,000". The regex finds positions followed by a
// multiple of 3 digits up to the end, but not at the very start.
function addCommas(digits) {
  return digits.replace(/\B(?=(\d{3})+$)/g, ',');
}

/**
 * Add commas to what the user is typing in the big amount box, so "1200"
 * shows as "1,200". Anything that isn't plain digits (e.g. "12.5" pasted
 * in) is shown exactly as typed, so validation can explain the problem.
 * The screen strips the commas again before parsing (see AddExpenseScreen).
 */
export function formatTypedAmount(typed) {
  return /^\d+$/.test(typed) ? addCommas(typed) : typed;
}

/**
 * Read what the user typed in an amount box.
 *
 *   "600"   → 600
 *   " 600 " → 600
 *   ""      → NaN   (nothing typed)
 *   "12.5"  → 12.5  (not whole — prepareExpense will reject it with a message)
 *   "abc"   → NaN
 *
 * We return NaN / decimals instead of guessing, so validation can explain
 * the problem to the user rather than silently changing their number.
 */
export function parseRupees(text) {
  const trimmed = (text || '').trim();
  if (trimmed === '') return NaN;
  return Number(trimmed);
}

/**
 * Describe a balance in words (see computeBalances in split.js):
 *    200 → "gets Rs 200"   (they are owed money)
 *   -250 → "owes Rs 250"
 *      0 → "settled up"
 */
export function describeBalance(balance) {
  if (balance > 0) return `gets ${formatRupees(balance)}`;
  if (balance < 0) return `owes ${formatRupees(balance)}`;
  return 'settled up';
}

/**
 * Show a category id as a label: "food" → "Food".
 */
export function categoryLabel(category) {
  if (!category) return '';
  return category[0].toUpperCase() + category.slice(1);
}

/**
 * Join names for "Paid by": ["A"] → "A", ["A","B"] → "A & B",
 * ["A","B","C"] → "A + 2 others". Keeps expense rows to one short line.
 */
export function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} + ${names.length - 1} others`;
}

// Names for dates. We build date text ourselves instead of using
// toLocaleDateString, so it looks the same on every phone.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A timestamp (milliseconds) as a day heading, in the phone's time zone:
 * → "Sunday, 28 Sep"
 */
export function formatDay(ms) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * A timestamp (milliseconds) as a short date: → "28 Sep"
 */
export function formatShortDate(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Group a list (already sorted, e.g. newest first) into one section per day,
 * using each item's created_at. Keeps the order it was given.
 *
 * → [{ title: 'Sunday, 28 Sep', data: [...] }, { title: 'Saturday, 27 Sep', ... }]
 *
 * This is the shape React Native's SectionList expects.
 */
export function groupByDay(items) {
  const sections = [];
  let lastKey = null;
  for (const item of items) {
    const d = new Date(item.created_at);
    // Same calendar day (in the phone's time zone) = same section.
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== lastKey) {
      sections.push({ title: formatDay(item.created_at), data: [] });
      lastKey = key;
    }
    sections[sections.length - 1].data.push(item);
  }
  return sections;
}

/**
 * The second line of an expense row:
 *   ['Hammal'], 4 people        → "Hammal paid, for 4"
 *   ['Naveed'], ['Zarak'] only  → "Naveed paid, for Zarak"
 *   ['A', 'B'], 3 people        → "A & B paid, for 3"
 *   fromFund = true             → "Paid from fund, for 4"
 */
export function describeExpense(payerNames, participantNames, fromFund = false) {
  const forWhom = participantNames.length === 1 ? participantNames[0] : participantNames.length;
  const paid = fromFund ? 'Paid from fund' : `${joinNames(payerNames)} paid`;
  return `${paid}, for ${forWhom}`;
}

/**
 * The line under a group's name: → "4 friends, Rs 8,500 spent"
 */
export function describeGroup(memberCount, totalSpent) {
  const friends = memberCount === 1 ? 'friend' : 'friends';
  return `${memberCount} ${friends}, ${formatRupees(totalSpent)} spent`;
}

/**
 * What a payment was, in words. `nameOf(id)` gives a member's name.
 *   settlement              → "Bilal paid Ali"
 *   contribution            → "Bilal put money in the fund"
 *   return (to someone)     → "Ali gave Bilal fund money back"
 *   return (holder keeps)   → "Ali kept leftover fund money"
 */
export function describePayment(payment, nameOf) {
  const from = nameOf(payment.fromId);
  const to = nameOf(payment.toId);
  if (payment.type === 'contribution') return `${from} put money in the fund`;
  if (payment.type === 'return') {
    return payment.fromId === payment.toId
      ? `${from} kept leftover fund money`
      : `${from} gave ${to} fund money back`;
  }
  return `${from} paid ${to}`;
}

/**
 * A short note about a payment's status, or '' for a confirmed one (the
 * normal case needs no note).
 *   pending   → "Waiting for Ali to confirm"
 *   pending, receiver not on YaarSplit (receiverOnApp = false)
 *             → "Ali isn't on YaarSplit yet, so an admin confirms"
 *   rejected  → "Ali said they didn't get it"
 *   cancelled → "Cancelled"
 */
export function describePaymentStatus(payment, nameOf, receiverOnApp = true) {
  if (payment.status === 'pending' && !receiverOnApp) {
    return `${nameOf(payment.toId)} isn’t on YaarSplit yet, so an admin confirms`;
  }
  if (payment.status === 'pending') return `Waiting for ${nameOf(payment.toId)} to confirm`;
  if (payment.status === 'rejected') return `${nameOf(payment.toId)} said they didn’t get it`;
  if (payment.status === 'cancelled') return 'Cancelled';
  return '';
}

// Payment statuses as one word, for the small label in payment history.
const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** "pending" → "Pending" (see PAYMENT_STATUSES in split.js). */
export function paymentStatusLabel(status) {
  return STATUS_LABELS[status] || '';
}

/**
 * A timestamp as a clock time, in the phone's time zone: → "3:20 PM"
 * (12-hour, like most phones in Pakistan show it).
 */
export function formatTime(ms) {
  const d = new Date(ms);
  const hours = d.getHours() % 12 || 12; // 0 → 12 (midnight), 13 → 1
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/**
 * When something happened, short:
 *   today       → "3:20 PM"
 *   another day → "28 Sep, 3:20 PM"
 * `now` is only passed by tests.
 */
export function formatWhen(ms, now = Date.now()) {
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? formatTime(ms) : `${formatShortDate(ms)}, ${formatTime(ms)}`;
}

/**
 * Who added / edited an expense, for its details screen.
 * Returns { added, edited }, each a line of text or null:
 *   added   "Added by Bilal"            (null if nobody's recorded: a group
 *                                        that only lives on this phone)
 *   edited  "Edited by Bilal, 3:20 PM"  (null if never edited;
 *                                        "Edited 3:20 PM" if we don't know who)
 * `nameOf(id)` gives a member's name.
 */
export function describeAuthors(expense, nameOf, now = Date.now()) {
  const added = expense.created_by ? `Added by ${nameOf(expense.created_by)}` : null;
  let edited = null;
  if (expense.edited_at) {
    const when = formatWhen(expense.edited_at, now);
    edited = expense.updated_by ? `Edited by ${nameOf(expense.updated_by)}, ${when}` : `Edited ${when}`;
  }
  return { added, edited };
}

/**
 * What's left between me and someone else, from historyBetween's
 * `remaining` (seen from my side: positive = they owe me):
 *    300 → "Nisar owes you Rs 300"
 *   -300 → "You owe Nisar Rs 300"
 *      0 → "You're even"
 */
export function describeRemaining(remaining, otherName) {
  if (remaining > 0) return `${otherName} owes you ${formatRupees(remaining)}`;
  if (remaining < 0) return `You owe ${otherName} ${formatRupees(remaining)}`;
  return 'You’re even';
}

/**
 * How long an invite still works (they last 7 days):
 *   → "Expires in 6 days" / "Expires tomorrow" / "Expires today" / "Expired"
 */
export function describeExpiry(expiresAt, now = Date.now()) {
  const left = expiresAt - now;
  if (left <= 0) return 'Expired';
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}
