// testData.js — DEV ONLY: fills the database with a known example so we can
// check the screens and the split maths on a real phone.
//
// Used by the "Load test data" button on the Groups screen, which only shows
// when __DEV__ is true (never in a release build). Delete this file once it's
// no longer useful.

import { addExpense, addGroup, addMember } from './queries';

/**
 * Create a "Test Trip" group with members A, B, C, D and three meals:
 *   Meal 1: A paid 600 for A, B, C
 *   Meal 2: B paid 800 for A, B, C, D
 *   Meal 3: C paid 300 for C, D
 *
 * Expected balances: A +200, B +400, C -250, D -350.
 * Returns the new group row.
 */
export function loadTestData() {
  const group = addGroup('Test Trip');

  // Make the members, and remember each one's id by name.
  const ids = {};
  for (const name of ['A', 'B', 'C', 'D']) {
    ids[name] = addMember(group.id, name).id;
  }

  // Small helper: an equal-split food expense paid in full by one person.
  function meal(description, payer, amount, forNames) {
    const result = addExpense(group.id, {
      description,
      amount,
      category: 'food',
      split_type: 'equal',
      payers: [{ member_id: ids[payer], amount }],
      participants: forNames.map((name) => ({ member_id: ids[name] })),
    });
    // If validation ever fails, make it loud instead of silently skipping.
    if (!result.ok) throw new Error(result.errors.join(' '));
  }
  meal('Meal 1', 'A', 600, ['A', 'B', 'C']);
  meal('Meal 2', 'B', 800, ['A', 'B', 'C', 'D']);
  meal('Meal 3', 'C', 300, ['C', 'D']);

  return group;
}
