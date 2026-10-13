/**
 * The access token, held in a module variable — i.e. in memory only.
 *
 * Deliberately NOT localStorage: anything stored there is readable by any
 * script on the page, so one XSS hole hands an attacker a token. In memory,
 * the token dies with the tab.
 *
 * Deliberately NOT React state either: the axios interceptor (MP-23) is not a
 * component and cannot call hooks, so it needs a token it can read from plain
 * module code. This is that place. AuthContext (MP-21) mirrors this into React
 * state for rendering; this module stays the source of truth.
 *
 * The cost of in-memory: a hard refresh loses the token. That is recovered by
 * POST /auth/refresh, which needs nothing but the httpOnly cookie (MP-23).
 */
let accessToken: string | null = null;

export const tokenStore = {
  get: (): string | null => accessToken,

  set: (token: string): void => {
    accessToken = token;
  },

  clear: (): void => {
    accessToken = null;
  },
};
