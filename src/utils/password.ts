// Argon2id is the current OWASP-recommended default for password hashing —
// stronger against GPU-cracking than bcrypt at equivalent settings, and
// actively maintained. bcrypt remains a fine alternative; this project just
// picks one and uses it consistently.
import argon2 from 'argon2';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
