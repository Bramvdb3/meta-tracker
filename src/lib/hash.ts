/**
 * Meta CAPI hashing helpers. Each helper normalizes per the Meta spec
 * (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters)
 * and returns a SHA-256 hex digest, or null if input is empty.
 */

import { createHash } from 'crypto';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalize(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export function hashEmail(email: string | null | undefined): string | null {
  const norm = normalize(email);
  return norm ? sha256(norm) : null;
}

export function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Strip everything that isn't a digit (Meta wants country code + digits, no '+' or spaces)
  const digits = phone.replace(/[^\d]/g, '');
  return digits ? sha256(digits) : null;
}

export function hashName(name: string | null | undefined): string | null {
  const norm = normalize(name);
  return norm ? sha256(norm) : null;
}

export function hashCity(city: string | null | undefined): string | null {
  if (!city) return null;
  // No spaces, lowercase
  const norm = city.trim().toLowerCase().replace(/\s+/g, '');
  return norm ? sha256(norm) : null;
}

export function hashState(state: string | null | undefined): string | null {
  if (!state) return null;
  // Letters only, lowercase. For US: 2-letter code preferred (CA, NY).
  const norm = state.trim().toLowerCase().replace(/[^a-z]/g, '');
  return norm ? sha256(norm) : null;
}

export function hashZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  // Meta wants the first 5 digits for US ZIPs and full code for others; trim and lowercase
  const norm = zip.trim().toLowerCase().split('-')[0];
  return norm ? sha256(norm) : null;
}

export function hashCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  // ISO-3166-1 alpha-2, lowercase
  const norm = country.trim().toLowerCase().slice(0, 2);
  return norm.length === 2 ? sha256(norm) : null;
}
