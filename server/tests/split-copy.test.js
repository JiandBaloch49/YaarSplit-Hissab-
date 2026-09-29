// split-copy.test.js — makes sure the server's copy of split.js matches the
// app's.
//
// Why a copy at all: on Render, the server is deployed from the server/
// folder only, so it can't import ../src/logic/split.js from the app.
// Why this test: if someone changes the money rules in the app and forgets
// the server (or the other way round), the phone and the server would
// disagree about what a valid expense is. This test fails the moment the
// two files differ. To fix it, copy the app's file over the server's:
//   cp src/logic/split.js server/src/logic/split.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const serverCopy = new URL('../src/logic/split.js', import.meta.url);
const appFile = new URL('../../src/logic/split.js', import.meta.url);

// Windows checkouts may use \r\n line endings; ignore that difference.
const read = (url) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');

test(
  'server/src/logic/split.js is identical to the app’s src/logic/split.js',
  // Skipped where only the server folder exists (e.g. on Render).
  { skip: !existsSync(appFile) && 'app folder not present' },
  () => {
    assert.equal(read(serverCopy), read(appFile), 'split.js copies differ — copy the app one over');
  }
);
