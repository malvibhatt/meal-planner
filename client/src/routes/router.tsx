/* eslint-disable react-refresh/only-export-components -- this module
   defines no components; the lazy() bindings only reference them. */
import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import { ROUTES, ROUTE_SEGMENTS } from "@/constants/routes";

const Dashboard = lazy(() => import("@/pages/DashboardPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const PlannerPage = lazy(() => import("@/pages/PlannerPage"));
const RecipeDetail = lazy(() => import("@/pages/RecipeDetail"));
const RecipesPage = lazy(() => import("@/pages/RecipesPage"));
const ShoppingPage = lazy(() => import("@/pages/ShoppingPage"));
const TodosPage = lazy(() => import("@/pages/TodosPage"));
const ForbiddenPage = lazy(() => import("@/pages/ForbiddenPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

const withSuspense = (el: React.ReactNode) => (
  <Suspense fallback={<p>Loading…</p>}>{el}</Suspense>
);

export const router = createBrowserRouter([
  // Login sits outside the layout — no header or sidebar on the login screen.
  { path: ROUTES.LOGIN, element: withSuspense(<LoginPage />) },
  {
    // A layout route: no path of its own, just chrome + <Outlet />.
    element: <AppLayout />,
    children: [
      // Child paths are relative to the parent — a leading slash would make
      // them absolute and break the nesting.
      { index: true, element: withSuspense(<Dashboard />) },
      { path: ROUTE_SEGMENTS.RECIPES, element: withSuspense(<RecipesPage />) },
      {
        path: ROUTE_SEGMENTS.RECIPE_DETAIL,
        element: withSuspense(<RecipeDetail />),
      },
      { path: ROUTE_SEGMENTS.PLANNER, element: withSuspense(<PlannerPage />) },
      { path: ROUTE_SEGMENTS.TODOS, element: withSuspense(<TodosPage />) },
      {
        path: ROUTE_SEGMENTS.SHOPPING,
        element: withSuspense(<ShoppingPage />),
      },
      {
        path: ROUTE_SEGMENTS.FORBIDDEN,
        element: withSuspense(<ForbiddenPage />),
      },
    ],
  },
  { path: ROUTES.NOT_FOUND, element: withSuspense(<NotFoundPage />) },
]);
