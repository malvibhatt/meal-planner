/**
 * Every API path in one place, same discipline as constants/routes.ts for
 * route paths. Paths are relative: axiosInstance's baseURL supplies the host.
 */
export const ENDPOINTS = {
  AUTH: {
    REGISTER: "/auth/register",
    LOGIN: "/auth/login",
    REFRESH: "/auth/refresh",
    LOGOUT: "/auth/logout",
    ME: "/auth/me",
  },
  INGREDIENTS: "/ingredients",
  RECIPES: "/recipes",
  UPLOADS: "/uploads",
} as const;

/**
 * ENDPOINTS.RECIPES is the collection. A single recipe needs an id
 * interpolated, so it's a function — exactly like recipeDetailPath()
 * in constants/routes.ts.
 */
export const recipePath = (id: string) => `${ENDPOINTS.RECIPES}/${id}`;
