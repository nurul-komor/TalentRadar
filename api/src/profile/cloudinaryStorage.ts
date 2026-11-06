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
