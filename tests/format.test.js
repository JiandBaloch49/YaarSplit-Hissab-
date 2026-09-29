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
