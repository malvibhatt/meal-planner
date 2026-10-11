import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { HttpError } from '../lib/httpError.ts'

export const uploadsRouter = Router()

/** Local disk for now. Swapping in S3 later means changing only this module. */
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')

// multer's diskStorage does not create its destination — it just fails on the
// first write. The repo tracks uploads/.gitkeep so the directory exists after
// a clone, but a deploy that copies only dist/ would not have it.
mkdirSync(UPLOAD_DIR, { recursive: true })

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

// Only formats a browser can actually render in an <img>.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, UPLOAD_DIR),

    filename: (_req, file, done) => {
      // The client-supplied filename is never used. `originalname` is
      // attacker-controlled: "../../etc/passwd" or a name ending ".php"
      // would both be bad in different ways. A random id plus an extension
      // derived from the *validated* mime type has neither problem.
      const extension = EXTENSION_BY_MIME[file.mimetype] ?? ''
      done(null, `${randomUUID()}${extension}`)
    },
  }),

  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    // One file, one field. Without these, a request can hold the parser open
    // with hundreds of parts.
    files: 1,
    fields: 0,
  },

  fileFilter: (_req, file, done) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      done(new HttpError(422, 'Validation failed', { file: 'Upload a JPEG, PNG, WebP or AVIF image' }))
      return
    }

    done(null, true)
  },
})

/**
 * POST /uploads — multipart form with a single `file` field.
 *
 * Returns an absolute URL rather than a bare filename, because the frontend
 * drops it straight into `<img src>` and that resolves against the page's
 * origin, not the API's.
 *
 * Note it requires auth: an open upload endpoint is free file hosting for
 * whoever finds it.
 */
uploadsRouter.post('/uploads', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      // Translate multer's own errors into the project's 422 shape; anything
      // else is a real failure and belongs to the error handler.
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? `File must be ${MAX_UPLOAD_BYTES / 1024 / 1024}MB or smaller`
            : 'Upload a single image in the "file" field'

        next(new HttpError(422, 'Validation failed', { file: message }))
        return
      }

      next(error)
      return
    }

    if (!req.file) {
      next(new HttpError(422, 'Validation failed', { file: 'No file was uploaded' }))
      return
    }

    res.status(201).json({
      url: `${env.PUBLIC_URL}/uploads/${req.file.filename}`,
      filename: req.file.filename,
      size: req.file.size,
    })
  })
})
