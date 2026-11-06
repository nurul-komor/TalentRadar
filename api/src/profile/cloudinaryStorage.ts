import { v2 as cloudinary } from 'cloudinary'

export interface UploadedFile {
  // The secure (https) URL the file can be fetched from.
  url: string
  // Cloudinary's identifier, needed to delete or overwrite the asset later.
  publicId: string
}

export type CvUploader = (
  buffer: Buffer,
  mimeType: string,
  filename: string
) => Promise<UploadedFile>

// CVs are PDF/DOCX binaries, not images, so they go to Cloudinary as `raw` assets.
const CV_FOLDER = 'job-hunter/cv'

/**
 * Builds a CV uploader backed by Cloudinary, or returns null when Cloudinary
 * isn't configured. Reads either CLOUDINARY_URL (cloudinary://key:secret@cloud)
 * or the three discrete CLOUDINARY_* vars — same as the Cloudinary SDK's own
 * convention. Keeping this injectable mirrors cvParser/resumeExtractor so routes
 * and tests can swap in a fake.
 */
export function createCloudinaryUploader(env: NodeJS.ProcessEnv): CvUploader | null {
  const hasUrl = Boolean(env.CLOUDINARY_URL)
  const hasDiscrete = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  )
  if (!hasUrl && !hasDiscrete) return null

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  })

  return async (buffer, _mimeType, filename) => {
    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: CV_FOLDER,
            resource_type: 'raw',
            // Keep the original filename (minus extension) in the public id so
            // the stored asset is recognizable in the Cloudinary dashboard.
            public_id: filename.replace(/\.[^./]+$/, '') || undefined,
            use_filename: true,
            unique_filename: true,
            overwrite: false,
          },
          (error, uploaded) => {
            if (error || !uploaded) {
              reject(error ?? new Error('cloudinary upload returned no result'))
              return
            }
            resolve({ secure_url: uploaded.secure_url, public_id: uploaded.public_id })
          }
        )
        stream.end(buffer)
      }
    )
    return { url: result.secure_url, publicId: result.public_id }
  }
}

// --- Admin file manager -----------------------------------------------------------------
// The settings-page file manager needs to list/delete/upload the stored uploads, not just
// write CVs. It shares the same Cloudinary config convention as the uploader above.

// All app uploads live under this namespace (CVs are in `${APP_FOLDER}/cv`), so a single
// prefixed listing returns everything the file manager should show.
const APP_FOLDER = 'job-hunter'
const ADMIN_UPLOAD_FOLDER = 'job-hunter/uploads'

export interface ManagedFile {
  publicId: string
  url: string
  bytes: number
  format: string | null
  createdAt: string | null
}

export interface CloudinaryFileManager {
  list(): Promise<ManagedFile[]>
  // Deletes the raw asset. Resolves true when Cloudinary reports it gone (or already absent).
  remove(publicId: string): Promise<boolean>
  upload(buffer: Buffer, filename: string): Promise<UploadedFile>
}

function configureCloudinary(env: NodeJS.ProcessEnv): boolean {
  const hasUrl = Boolean(env.CLOUDINARY_URL)
  const hasDiscrete = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
  )
  if (!hasUrl && !hasDiscrete) return false
  // When only CLOUDINARY_URL is set the SDK reads it from the environment automatically;
  // the discrete vars (if present) are applied explicitly here.
  if (hasDiscrete) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    })
  } else {
    cloudinary.config({ secure: true })
  }
  return true
}

// Builds the admin file manager, or null when Cloudinary isn't configured.
export function createCloudinaryFileManager(env: NodeJS.ProcessEnv): CloudinaryFileManager | null {
  if (!configureCloudinary(env)) return null

  return {
    async list(): Promise<ManagedFile[]> {
      // Uploads are stored as `raw` assets; list everything under the app namespace.
      const result = await cloudinary.api.resources({
        resource_type: 'raw',
        type: 'upload',
        prefix: APP_FOLDER,
        max_results: 100,
      })
      const resources: Array<{
        public_id: string
        secure_url: string
        bytes?: number
        format?: string
        created_at?: string
      }> = result.resources ?? []
      return resources.map((r) => ({
        publicId: r.public_id,
        url: r.secure_url,
        bytes: r.bytes ?? 0,
        format: r.format ?? null,
        createdAt: r.created_at ?? null,
      }))
    },

    async remove(publicId: string): Promise<boolean> {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' })
      return result.result === 'ok' || result.result === 'not found'
    },

    async upload(buffer: Buffer, filename: string): Promise<UploadedFile> {
      const result = await new Promise<{ secure_url: string; public_id: string }>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: ADMIN_UPLOAD_FOLDER,
              resource_type: 'raw',
              public_id: filename.replace(/\.[^./]+$/, '') || undefined,
              use_filename: true,
              unique_filename: true,
              overwrite: false,
            },
            (error, uploaded) => {
              if (error || !uploaded) {
                reject(error ?? new Error('cloudinary upload returned no result'))
                return
              }
              resolve({ secure_url: uploaded.secure_url, public_id: uploaded.public_id })
            }
          )
          stream.end(buffer)
        }
      )
      return { url: result.secure_url, publicId: result.public_id }
    },
  }
}
