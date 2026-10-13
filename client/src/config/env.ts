/**
 * Every environment variable the client reads, in one place, checked once at
 * module load. Mirrors server/src/config/env.ts: a missing variable fails
 * immediately with a readable message instead of surfacing as `undefined`
 * inside a request URL three layers deep.
 */

const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy client/.env.example to client/.env.local and fill it in.`
    );
  }

  return value;
};

export const env = {
  apiUrl: required("VITE_API_URL", import.meta.env.VITE_API_URL),
} as const;
