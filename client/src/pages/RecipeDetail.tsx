import { useParams } from "react-router-dom";

function RecipeDetail() {
  const { id } = useParams();
  return <h2>RecipeDetail ({id})</h2>;
}

export default RecipeDetail;
