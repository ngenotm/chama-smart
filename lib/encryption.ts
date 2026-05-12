/**
 * lib/encryption.ts
 * AES-256-GCM encryption utility for securing sensitive data at rest.
 * Used to encrypt Chama M-Pesa passkeys before storing in DB.
 *
 * Requires env: ENCRYPTION_KEY (64-char hex string = 32 bytes)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Get the 32-byte encryption key from environment variable.
 * Throws if not set or invalid length.
 */
function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Got ${hex.length} chars.`
    );
  }
  return buf;
}

/**
 * Encrypt a plaintext string.
 * Returns a hex-encoded string: IV (32 hex) + AuthTag (32 hex) + Ciphertext (hex)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Concatenate: iv + authTag + ciphertext (all hex)
  return iv.toString("hex") + authTag.toString("hex") + encrypted;
}

/**
 * Decrypt a hex-encoded ciphertext produced by encrypt().
 * Returns the original plaintext string.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();

  // Extract IV (first 32 hex chars = 16 bytes)
  const ivHex = ciphertext.slice(0, IV_LENGTH * 2);
  const iv = Buffer.from(ivHex, "hex");

  // Extract auth tag (next 32 hex chars = 16 bytes)
  const authTagHex = ciphertext.slice(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);
  const authTag = Buffer.from(authTagHex, "hex");

  // Rest is the encrypted data
  const encryptedHex = ciphertext.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
