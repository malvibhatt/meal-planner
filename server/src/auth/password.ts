import bcrypt from 'bcryptjs'

/**
 * Cost factor 12. Each increment doubles the work: 12 lands around 200-300ms
 * on a modern laptop, which is slow enough to make offline cracking expensive
 * and fast enough that a login does not feel broken. Raise it, never lower it.
 */
const BCRYPT_COST = 12

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST)

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash)
