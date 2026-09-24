/**
 * Every path in the app, in one place. Components import from here —
 * no route string literals anywhere else.
 */
export const ROUTES = {
  DASHBOARD: "/",
  RECIPES: "/recipes",
  RECIPE_DETAIL: "/recipes/:id",
  PLANNER: "/planner",
  TODOS: "/todos",
  SHOPPING: "/shopping",
  LOGIN: "/login",
  FORBIDDEN: "/403",
  NOT_FOUND: "*",
} as const;

/**
 * Children of a layout route are matched relative to their parent, so the
 * route tree needs these unprefixed forms. Keep them in sync with ROUTES.
 */
export const ROUTE_SEGMENTS = {
  RECIPES: "recipes",
  RECIPE_DETAIL: "recipes/:id",
  PLANNER: "planner",
  TODOS: "todos",
  SHOPPING: "shopping",
  FORBIDDEN: "403",
} as const;

/**
 * ROUTES.RECIPE_DETAIL is the pattern the router matches on — never navigate
 * to it directly. Build a real, navigable URL with this instead.
 */
export const recipeDetailPath = (id: string) => `${ROUTES.RECIPES}/${id}`;
