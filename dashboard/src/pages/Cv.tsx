import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Profile } from '@job-hunter/shared'
import { apiFetch, getToken } from '../api/client'
import { AppNav } from '../components/Nav'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'

const MAX_CV_FILE_BYTES = 10 * 1024 * 1024
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', DOCX_MIME_TYPE])

type Stage = 'upload' | 'parsing' | 'done'

function stageClass(stage: Stage, target: Stage, order: Stage[]): string {
  if (stage === target) return 'cur'
  return order.indexOf(stage) > order.indexOf(target) ? 'done' : ''
}

function validateCvFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return 'Unsupported file type. Upload a PDF or DOCX.'
  }
  if (file.size > MAX_CV_FILE_BYTES) {
    return 'File is too large. Maximum size is 10MB.'
  }
  return null
}

async function uploadCv(file: File): Promise<Profile> {
  const formData = new FormData()
  formData.append('file', file)
  const token = getToken()
  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
  const res = await fetch(`${apiBaseUrl}/profile/cv`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? 'Failed to parse CV.')
  }
  return res.json()
}

const STAGE_ORDER: Stage[] = ['upload', 'parsing', 'done']

export function CvPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('upload')
  const [replacing, setReplacing] = useState(false)
  const [parsingProgressPct, setParsingProgressPct] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // There's no server-sent progress for the parse request (it's a single
  // request/response), so this is a rough elapsed-time estimate rather than
  // a real percentage — it eases toward (but never reaches) 100% so it never
  // claims to be further along than we actually know.
  useEffect(() => {
    if (stage !== 'parsing') {
      setParsingProgressPct(0)
      return
    }
    const startedAt = Date.now()
    const ESTIMATED_PARSE_MS = 4000
    const intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt
      const estimatedPct = 92 * (1 - Math.exp(-elapsedMs / ESTIMATED_PARSE_MS))
      setParsingProgressPct(estimatedPct)
    }, 120)
    return () => window.clearInterval(intervalId)
  }, [stage])

  useEffect(() => {
    apiFetch('/profile').then(async (res) => {
      if (!res.ok) {
        setLoadError('Failed to load profile.')
        return
      }
      const data: Profile = await res.json()
      setProfile(data)
      if (data.cvText) {
        setStage('done')
      }
    })
  }, [])

  const handleFile = useCallback((file: File) => {
    const validationError = validateCvFile(file)
    if (validationError) {
      setUploadError(validationError)
      return
    }
    setUploadError(null)
    setSelectedFile(file)
    setStage('parsing')
    uploadCv(file)
      .then((updatedProfile) => {
        setProfile(updatedProfile)
        setStage('done')
        setReplacing(false)
      })
      .catch((err: Error) => {
        setUploadError(err.message)
        setStage('upload')
      })
  }, [])

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleBrowse(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function startReplace() {
    setReplacing(true)
    setUploadError(null)
    setSelectedFile(null)
    setStage('upload')
  }

  const showDropZone = stage !== 'done' && !(profile?.cvText && !replacing)
  const cvText = profile?.cvText ?? null
  const wordCount = cvText ? cvText.trim().split(/\s+/).filter(Boolean).length : 0

  return (
    <div>
      <AppNav />
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Profile</div>
          <h1>Your CV</h1>
          <p>Upload a PDF or DOCX and we'll extract the text so it can be matched against job listings.</p>
        </div>
      </header>
      <section className="page-pad">
        <div className="wrap" style={{ maxWidth: 720 }}>
          {loadError && (
            <div className="mb-4">
              <FormError message={loadError} />
            </div>
          )}

          <div className="stages">
            <div className={stageClass(stage, 'upload', STAGE_ORDER)}>
              <span className="n">1</span>Upload
            </div>
            <div className={stageClass(stage, 'parsing', STAGE_ORDER)}>
              <span className="n">2</span>Parsing
            </div>
            <div className={stageClass(stage, 'done', STAGE_ORDER)}>
              <span className="n">3</span>Done
            </div>
          </div>

          {uploadError && (
            <div style={{ marginTop: 18 }}>
              <FormError message={uploadError} />
            </div>
          )}

          {showDropZone ? (
            <div
              className={`drop${dragOver ? ' dragover' : ''}`}
              style={{ marginTop: 18 }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="thumb">
                <i />
                <i style={{ width: '80%' }} />
                <i style={{ width: '70%' }} />
                <i style={{ width: '90%' }} />
                {stage === 'parsing' && <div className="scan" />}
              </div>

              {stage === 'parsing' ? (
                <>
                  <b>Parsing {selectedFile?.name}…</b>
                  <p>Extracting text from your CV. This usually takes a few seconds.</p>
                  <div className="prog">
                    <i style={{ width: `${parsingProgressPct}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <b>Drag and drop your CV here</b>
                  <p>PDF or DOCX, up to 10MB.</p>
                  <div className="actions">
                    <Button type="button" onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </Button>
                    {replacing && (
                      <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx"
                    onChange={handleBrowse}
                    style={{ display: 'none' }}
                  />
                </>
              )}
            </div>
          ) : (
            cvText && (
              <div className="extract" style={{ marginTop: 18 }}>
                <h3>
                  CV on file
                  <span className="meta" style={{ marginTop: 0, fontSize: 12 }}>
                    {cvText.length.toLocaleString()} characters · {wordCount.toLocaleString()} words
                  </span>
                </h3>
                <div className="cv-preview">{cvText}</div>
                <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 18 }}>
                  <Button type="button" onClick={startReplace}>
                    Replace CV
                  </Button>
                  <Link to="/profile" className="btn btn-ghost">
                    Back to profile
                  </Link>
                </div>
              </div>
            )
          )}
        </div>
      </section>
    </div>
  )
}
