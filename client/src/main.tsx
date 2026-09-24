import { ConfigProvider } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./index.css";
import { router } from "@/routes/router";

// antd renders its own palette and knows nothing about the light/dark blocks
// in index.css. Pointing its tokens at our CSS variables lets the browser
// resolve them per theme, so antd follows prefers-color-scheme for free.
const theme = {
  token: {
    colorText: "var(--text-h)",
    colorTextSecondary: "var(--text)",
    colorBorder: "var(--border)",
  },
  components: {
    Skeleton: {
      gradientFromColor: "color-mix(in srgb, var(--text) 16%, transparent)",
      gradientToColor: "color-mix(in srgb, var(--text) 30%, transparent)",
    },
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider theme={theme}>
      <RouterProvider router={router} />
    </ConfigProvider>
  </StrictMode>
);
