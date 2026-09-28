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
  const digits = String(Math.abs(amount));
  // Put a comma before every group of 3 digits from the right:
  // "1200000" → "1,200,000". The regex finds positions followed by a
  // multiple of 3 digits up to the end, but not at the very start.
  const withCommas = digits.replace(/\B(?=(\d{3})+$)/g, ',');
  return `Rs ${withCommas}`;
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
