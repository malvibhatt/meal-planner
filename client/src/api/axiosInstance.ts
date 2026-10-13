import axios from "axios";
import { env } from "@/config/env";

/**
 * The single axios instance the whole app shares. Nothing imports `axios`
 * directly, and that rule is what makes MP-23 possible: interceptors attached
 * here apply to every request in the app, with no second instance quietly
 * bypassing them.
 */
export const api = axios.create({
  baseURL: env.apiUrl,

  // Sends the httpOnly refresh cookie on cross-origin requests. Without this
  // the browser withholds it and /auth/refresh can never work — localhost:5173
  // and localhost:4000 are different origins as far as CORS is concerned.
  // It pairs with `credentials: true` in the server's cors() config.
  withCredentials: true,

  // axios has NO default timeout: a request to a hung server waits forever and
  // the user stares at a spinner with nothing to click.
  timeout: 10_000,
});
