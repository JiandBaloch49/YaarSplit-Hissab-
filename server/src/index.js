// index.js — starts the real server: connect to MongoDB, then listen.
//
// Settings come from environment variables, never from code, so no secret
// ever ends up in git:
//   MONGODB_URI  the MongoDB Atlas connection string (required)
//   PORT         the port to listen on (Render sets this itself; 3000 locally)
//
// Locally, put them in server/.env (see .env.example) and run `npm run dev`.
// On Render, set them in the service's "Environment" tab.

import mongoose from 'mongoose';
import { createApp } from './app.js';

const uri = process.env.MONGODB_URI;
const port = Number(process.env.PORT) || 3000;

if (!uri) {
  console.error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

await mongoose.connect(uri);
// Make sure the indexes in models.js (unique invite codes etc.) exist.
await mongoose.syncIndexes();
console.log('Connected to MongoDB');

createApp().listen(port, () => {
  console.log(`YaarSplit server listening on port ${port}`);
});
