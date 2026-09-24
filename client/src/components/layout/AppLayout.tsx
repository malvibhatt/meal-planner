import { NavLink, Outlet } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import "./AppLayout.css";

const NAV_ITEMS = [
  // `end` stops the dashboard link matching every route: "/" is a prefix of
  // all of them, so without it the link stays highlighted everywhere.
  { to: ROUTES.DASHBOARD, label: "Dashboard", end: true },
  { to: ROUTES.RECIPES, label: "Recipes" },
  { to: ROUTES.PLANNER, label: "Planner" },
  { to: ROUTES.TODOS, label: "Todos" },
  { to: ROUTES.SHOPPING, label: "Shopping" },
];

function AppLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <h2>Meal Planner</h2>
        <small className="app-version">v{__APP_VERSION__}</small>
      </header>

      <div className="app-body">
        <nav className="app-sidebar">
          {NAV_ITEMS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link--active" : "nav-link"
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
