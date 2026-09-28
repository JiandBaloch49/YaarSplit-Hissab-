// format.test.js — tests for src/logic/format.js (rupee text in and out).
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRupees, parseRupees, describeBalance, categoryLabel, joinNames } from '../src/logic/format.js';

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
