// register.mjs — switches on loader.mjs before any test runs.
// Used with: node --import ./tests/helpers/register.mjs --test ...

import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
