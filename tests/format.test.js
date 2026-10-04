// format.test.js — tests for src/logic/format.js (text shown on screen, and typed amounts).
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRupees,
  formatTypedAmount,
  parseRupees,
  describeBalance,
  categoryLabel,
  joinNames,
  formatDay,
  formatShortDate,
  groupByDay,
  describeExpense,
  describeGroup,
  describePayment,
  describePaymentStatus,
  paymentStatusLabel,
  formatTime,
  formatWhen,
  describeAuthors,
  describeRemaining,
  describeExpiry,
} from '../src/logic/format.js';

test('formatRupees adds commas and the Rs prefix', () => {
  assert.equal(formatRupees(0), 'Rs 0');
  assert.equal(formatRupees(600), 'Rs 600');
  assert.equal(formatRupees(1200), 'Rs 1,200');
  assert.equal(formatRupees(1200000), 'Rs 1,200,000');
});

test('formatRupees drops the minus sign', () => {
  assert.equal(formatRupees(-250), 'Rs 250');
});

test('parseRupees reads whole numbers and leaves bad input for validation', () => {
  assert.equal(parseRupees('600'), 600);
  assert.equal(parseRupees(' 600 '), 600);
  assert.ok(Number.isNaN(parseRupees('')));
  assert.ok(Number.isNaN(parseRupees(undefined)));
  assert.ok(Number.isNaN(parseRupees('abc')));
  assert.equal(parseRupees('12.5'), 12.5);
});

test('describeBalance says gets / owes / settled up', () => {
  assert.equal(describeBalance(200), 'gets Rs 200');
  assert.equal(describeBalance(-250), 'owes Rs 250');
  assert.equal(describeBalance(0), 'settled up');
});

test('categoryLabel and joinNames', () => {
  assert.equal(categoryLabel('food'), 'Food');
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B']), 'A & B');
  assert.equal(joinNames(['A', 'B', 'C']), 'A + 2 others');
});

test('formatTypedAmount adds commas only to plain digits', () => {
  assert.equal(formatTypedAmount(''), '');
  assert.equal(formatTypedAmount('1200'), '1,200');
  assert.equal(formatTypedAmount('12.5'), '12.5');
});

test('formatDay and formatShortDate use the phone time zone', () => {
  // new Date(year, monthIndex, day) is local time, like on the phone.
  const ms = new Date(2025, 8, 28, 21, 30).getTime(); // Sunday 28 Sep 2025, 9:30 pm
  assert.equal(formatDay(ms), 'Sunday, 28 Sep');
  assert.equal(formatShortDate(ms), '28 Sep');
});

test('groupByDay makes one section per calendar day, keeping order', () => {
  const at = (day, hour) => ({ id: `${day}-${hour}`, created_at: new Date(2025, 8, day, hour).getTime() });
  const sections = groupByDay([at(28, 21), at(28, 8), at(27, 13)]);
  assert.deepEqual(
    sections.map((s) => [s.title, s.data.map((e) => e.id)]),
    [
      ['Sunday, 28 Sep', ['28-21', '28-8']],
      ['Saturday, 27 Sep', ['27-13']],
    ]
  );
  assert.deepEqual(groupByDay([]), []);
});

test('describeExpense and describeGroup', () => {
  assert.equal(describeExpense(['Hammal'], ['A', 'B', 'C', 'D']), 'Hammal paid, for 4');
  assert.equal(describeExpense(['Naveed'], ['Zarak']), 'Naveed paid, for Zarak');
  assert.equal(describeExpense(['A', 'B'], ['A', 'B', 'C']), 'A & B paid, for 3');
  assert.equal(describeExpense(['Hammal'], ['A', 'B', 'C', 'D'], true), 'Paid from fund, for 4');
  assert.equal(describeGroup(4, 8500), '4 friends, Rs 8,500 spent');
  assert.equal(describeGroup(1, 0), '1 friend, Rs 0 spent');
});

test('describePayment and describePaymentStatus', () => {
  const nameOf = (id) => ({ a: 'Ali', b: 'Bilal' })[id];
  const pay = (fromId, toId, type, status = 'confirmed') => ({ fromId, toId, type, status });
  assert.equal(describePayment(pay('b', 'a', 'settlement'), nameOf), 'Bilal paid Ali');
  assert.equal(describePayment(pay('b', 'a', 'contribution'), nameOf), 'Bilal put money in the fund');
  assert.equal(describePayment(pay('a', 'b', 'return'), nameOf), 'Ali gave Bilal fund money back');
  assert.equal(describePayment(pay('a', 'a', 'return'), nameOf), 'Ali kept leftover fund money');

  assert.equal(describePaymentStatus(pay('b', 'a', 'settlement', 'pending'), nameOf), 'Waiting for Ali to confirm');
  assert.equal(describePaymentStatus(pay('b', 'a', 'settlement', 'rejected'), nameOf), 'Ali said they didn’t get it');
  assert.equal(describePaymentStatus(pay('b', 'a', 'settlement', 'cancelled'), nameOf), 'Cancelled');
  assert.equal(describePaymentStatus(pay('b', 'a', 'settlement'), nameOf), '');
});

test('describePaymentStatus: says clearly when the receiver is not on YaarSplit', () => {
  const nameOf = (id) => ({ a: 'Ali', b: 'Bilal' })[id];
  const pending = { fromId: 'b', toId: 'a', status: 'pending', type: 'settlement' };
  assert.equal(
    describePaymentStatus(pending, nameOf, false),
    'Ali isn’t on YaarSplit yet, so an admin confirms'
  );
  assert.equal(paymentStatusLabel('rejected'), 'Rejected');
});

test('formatTime and formatWhen: "3:20 PM", and the date when not today', () => {
  const at = (h, m, day = 28) => new Date(2026, 8, day, h, m).getTime(); // September
  assert.equal(formatTime(at(15, 20)), '3:20 PM');
  assert.equal(formatTime(at(0, 5)), '12:05 AM');
  assert.equal(formatTime(at(12, 0)), '12:00 PM');
  assert.equal(formatWhen(at(15, 20), at(18, 0)), '3:20 PM');
  assert.equal(formatWhen(at(15, 20, 27), at(18, 0)), '27 Sep, 3:20 PM');
});

test('describeAuthors: "Added by" and "Edited by", only when known', () => {
  const nameOf = (id) => ({ b: 'Bilal', a: 'Ali' })[id];
  const now = new Date(2026, 8, 28, 18, 0).getTime();
  const editedAt = new Date(2026, 8, 28, 15, 20).getTime();
  assert.deepEqual(describeAuthors({ created_by: 'b', updated_by: 'b', edited_at: null }, nameOf, now), {
    added: 'Added by Bilal',
    edited: null,
  });
  assert.deepEqual(describeAuthors({ created_by: 'b', updated_by: 'a', edited_at: editedAt }, nameOf, now), {
    added: 'Added by Bilal',
    edited: 'Edited by Ali, 3:20 PM',
  });
  // A group that only lives on this phone: nobody's recorded.
  assert.deepEqual(describeAuthors({ created_by: null, updated_by: null, edited_at: editedAt }, nameOf, now), {
    added: null,
    edited: 'Edited 3:20 PM',
  });
});

test('describeRemaining and describeExpiry', () => {
  assert.equal(describeRemaining(300, 'Nisar'), 'Nisar owes you Rs 300');
  assert.equal(describeRemaining(-1200, 'Nisar'), 'You owe Nisar Rs 1,200');
  assert.equal(describeRemaining(0, 'Nisar'), 'You’re even');

  const day = 24 * 60 * 60 * 1000;
  const now = 1_000_000_000_000;
  assert.equal(describeExpiry(now + 6.5 * day, now), 'Expires in 6 days');
  assert.equal(describeExpiry(now + 1.2 * day, now), 'Expires tomorrow');
  assert.equal(describeExpiry(now + 3600 * 1000, now), 'Expires today');
  assert.equal(describeExpiry(now - 1, now), 'Expired');
});
