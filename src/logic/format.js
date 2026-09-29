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
 */
export function describeExpense(payerNames, participantNames) {
  const forWhom = participantNames.length === 1 ? participantNames[0] : participantNames.length;
  return `${joinNames(payerNames)} paid, for ${forWhom}`;
}

/**
 * The line under a group's name: → "4 friends, Rs 8,500 spent"
 */
export function describeGroup(memberCount, totalSpent) {
  const friends = memberCount === 1 ? 'friend' : 'friends';
  return `${memberCount} ${friends}, ${formatRupees(totalSpent)} spent`;
}
