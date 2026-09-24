import { recipeDetailPath } from "@/constants/routes";
import { Link } from "react-router-dom";

function RecipesPage() {
  return (
    <div>
      <h2>RecipesPage</h2>
      <Link style={{ textDecoration: "none" }} to={recipeDetailPath("123")}>
        ABC Recipe Details{" "}
      </Link>
    </div>
  );
}

export default RecipesPage;
