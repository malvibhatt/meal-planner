import type { RequestHandler } from 'express'

/**
 * Catch-all for unmatched routes. Registered last, so it only runs when no
 * router claimed the request. Without it Express 5 would send its own HTML
 * 404 page — and the frontend's axios error normaliser (MP-30) expects JSON
 * from every endpoint, including the ones that do not exist.
 */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` })
}
