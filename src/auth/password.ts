import { hash, verify, Algorithm } from '@node-rs/argon2'

const HASH_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, HASH_OPTS)
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try { return await verify(hashed, plain) }
  catch { return false }
}
