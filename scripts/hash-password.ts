#!/usr/bin/env tsx
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: tsx scripts/hash-password.ts <password>');
  process.exit(1);
}

console.log(bcrypt.hashSync(pw, 12));
