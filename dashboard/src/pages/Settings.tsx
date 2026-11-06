import { useEffect, useState } from 'react'
import type {
  AiSettingsView,
  AiSettingsUpdate,
  EmbeddingMode,
  LlmProviderName,
} from '@job-hunter/shared'
import { apiFetch, getToken } from '../api/client'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const card = 'rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900'
const fieldLabel = 'text-sm font-medium text-slate-700 dark:text-slate-200'
const helpText = 'text-xs text-slate-500 dark:text-slate-400'

// ---------------------------------------------------------------------------------------
// AI Credentials
// ---------------------------------------------------------------------------------------

const PROVIDERS: LlmProviderName[] = ['anthropic', 'openai', 'gemini']

function AiCredentialsTab() {
  const [view, setView] = useState<AiSettingsView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Draft edits. Keys are only sent when the user types a value (empty = leave unchanged).
  const [provider, setProvider] = useState<LlmProviderName>('anthropic')
  const [keys, setKeys] = useState({ anthropic: '', openai: '', gemini: '' })
  const [models, setModels] = useState({ resume: '', requirements: '', materials: '' })
  const [embeddingMode, setEmbeddingMode] = useState<EmbeddingMode>('ai')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [embeddingDimensions, setEmbeddingDimensions] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  function hydrate(v: AiSettingsView) {
    setView(v)
    setProvider(v.llmProvider)
    setModels({
      resume: v.models.resume ?? '',
      requirements: v.models.requirements ?? '',
      materials: v.models.materials ?? '',
    })
    setEmbeddingMode(v.embeddingMode)
    setEmbeddingModel(v.embeddingModel)
    setEmbeddingDimensions(String(v.embeddingDimensions))
    setKeys({ anthropic: '', openai: '', gemini: '' })
  }

  function load() {
    setLoadError(null)
    apiFetch('/admin/settings/ai')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load AI settings.')
        hydrate(await res.json())
      })
      .catch((e) => setLoadError(e.message ?? 'Failed to load AI settings.'))
  }

  useEffect(load, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setMessage(null)
    const update: AiSettingsUpdate = {
      llmProvider: provider,
      models: {
        resume: models.resume.trim() || undefined,
        requirements: models.requirements.trim() || undefined,
        materials: models.materials.trim() || undefined,
      },
      embeddingMode,
      embeddingModel: embeddingModel.trim(),
      embeddingDimensions: Number.parseInt(embeddingDimensions, 10) || undefined,
    }
    // Only send a key when the operator typed one (empty box = leave the stored key as-is).
    if (keys.anthropic.trim()) update.anthropicApiKey = keys.anthropic.trim()
    if (keys.openai.trim()) update.openaiApiKey = keys.openai.trim()
    if (keys.gemini.trim()) update.geminiApiKey = keys.gemini.trim()

    try {
      const res = await apiFetch('/admin/settings/ai', {
        method: 'PUT',
        body: JSON.stringify(update),
      })
      if (!res.ok) throw new Error('Failed to save settings.')
      hydrate(await res.json())
      setMessage('Settings saved and applied.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function clearKey(name: 'anthropic' | 'openai' | 'gemini') {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await apiFetch('/admin/settings/ai', {
        method: 'PUT',
        body: JSON.stringify({ [`${name}ApiKey`]: null }),
      })
      if (!res.ok) throw new Error('Failed to clear key.')
      hydrate(await res.json())
      setMessage(`Cleared ${name} key.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear key.')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiFetch('/admin/settings/ai/test', { method: 'POST' })
      const body = await res.json()
      const llm = body.llm?.ok ? `LLM OK (${body.llm.provider})` : `LLM failed: ${body.llm?.error ?? 'unknown'}`
      const emb = body.embedder?.ok
        ? `Embedder OK (${body.embedder.model}, ${body.embedder.dimensions} dims)`
        : `Embedder failed: ${body.embedder?.error ?? 'unknown'}`
      setTestResult(`${llm}\n${emb}`)
    } catch {
      setTestResult('Test request failed.')
    } finally {
      setTesting(false)
    }
  }

  if (loadError) return <FormError message={loadError} />
  if (!view) return <p className={helpText}>Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <h3 className="font-semibold text-slate-900 dark:text-white">Language model</h3>
        <p className={`mt-1 ${helpText}`}>
          Powers scoring, materials generation, and résumé auto-fill. Keys saved here override
          environment variables and apply immediately.
        </p>

        <div className="mt-4 flex flex-col gap-1">
          <Label className={fieldLabel}>Provider</Label>
          <select
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProviderName)}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <span className={helpText}>
            {view.llmReady ? '✓ A key is configured for the selected provider.' : '⚠ No key for this provider yet.'}
          </span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(['anthropic', 'openai', 'gemini'] as const).map((name) => {
            const status = view.keys[name]
            return (
              <div key={name} className="flex flex-col gap-1">
                <Label className={fieldLabel}>{name} API key</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={status.configured ? `•••• ${status.hint} (${status.source})` : 'not set'}
                  value={keys[name]}
                  onChange={(e) => setKeys((k) => ({ ...k, [name]: e.target.value }))}
                />
                {status.configured && status.source === 'db' && (
                  <button
                    type="button"
                    className="self-start text-xs text-red-600 hover:underline"
                    onClick={() => clearKey(name)}
                    disabled={saving}
                  >
                    Clear stored key
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(['resume', 'requirements', 'materials'] as const).map((cap) => (
            <div key={cap} className="flex flex-col gap-1">
              <Label className={fieldLabel}>{cap} model</Label>
              <Input
                placeholder="provider default"
                value={models[cap]}
                onChange={(e) => setModels((m) => ({ ...m, [cap]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-slate-900 dark:text-white">Embeddings (vector generation)</h3>
        <p className={`mt-1 ${helpText}`}>
          Choose how job/résumé vectors are produced. <b>AI</b> uses the OpenAI embeddings API
          (needs an OpenAI key). <b>Manual</b> runs a local Hugging Face model in-process — no API
          key or cost. Switching mode or model changes vector dimensions; run a full reindex in the
          Vectors tab afterwards.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label className={fieldLabel}>Mode</Label>
            <select
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={embeddingMode}
              onChange={(e) => setEmbeddingMode(e.target.value as EmbeddingMode)}
            >
              <option value="ai">AI (OpenAI)</option>
              <option value="manual">Manual (local HF)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className={fieldLabel}>Model</Label>
            <Input
              placeholder={embeddingMode === 'manual' ? 'Xenova/all-MiniLM-L6-v2' : 'text-embedding-3-small'}
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className={fieldLabel}>Dimensions</Label>
            <Input
              type="number"
              value={embeddingDimensions}
              onChange={(e) => setEmbeddingDimensions(e.target.value)}
            />
          </div>
        </div>
        <span className={`mt-2 block ${helpText}`}>
          {view.embedderReady ? '✓ Embedder is ready.' : '⚠ Embedder not configured.'}
        </span>
      </div>

      {error && <FormError message={error} />}
      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {testResult && (
        <pre className={`${card} whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200`}>{testResult}</pre>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <Button variant="ghost" onClick={handleTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <span className={helpText}>Last updated {formatDateTime(view.updatedAt)} {view.updatedBy ? `by ${view.updatedBy}` : ''}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------------------

interface VectorStatus {
  mode: EmbeddingMode
  embeddingModel: string
  dimensions: number
  embedderReady: boolean
  vectorSearch: string
  counts: { total: number; embedded: number; pending: number; unembedded: number }
}

interface VectorJob {
  _id: string
  title: string
  company: string
  status: string
  embedded: boolean
  embeddingModel: string | null
  embeddedAt: string | null
}

function VectorsTab() {
  const [status, setStatus] = useState<VectorStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)
  const [jobs, setJobs] = useState<VectorJob[]>([])
  const [filter, setFilter] = useState<'all' | 'embedded' | 'unembedded'>('all')

  function loadStatus() {
    apiFetch('/admin/vectors/status')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load vector status.')
        setStatus(await res.json())
      })
      .catch((e) => setError(e.message))
  }

  function loadJobs() {
    const q = filter === 'all' ? '' : `?filter=${filter}`
    apiFetch(`/admin/vectors/jobs${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load jobs.')
        const body = await res.json()
        setJobs(body.items)
      })
      .catch((e) => setError(e.message))
  }

  useEffect(loadStatus, [])
  useEffect(loadJobs, [filter])

  async function reindex(force: boolean) {
    setBusy(true)
    setRunResult(null)
    setError(null)
    try {
      const res = await apiFetch(`/admin/vectors/reindex${force ? '?force=true' : ''}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Reindex failed.')
      setRunResult(
        `Checked ${body.checked}, embedded ${body.embedded}, skipped ${body.skipped}, deferred ${body.deferred}, failed ${body.failed}.`
      )
      loadStatus()
      loadJobs()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reindex failed.')
    } finally {
      setBusy(false)
    }
  }

  async function reembedOne(id: string) {
    await apiFetch(`/admin/vectors/jobs/${id}/reembed`, { method: 'POST' })
    loadStatus()
    loadJobs()
  }

  async function clearOne(id: string) {
    await apiFetch(`/admin/vectors/jobs/${id}/embedding`, { method: 'DELETE' })
    loadStatus()
    loadJobs()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <FormError message={error} />}
      <div className={card}>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className={helpText}>Mode</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{status?.mode ?? '—'}</dd>
          </div>
          <div>
            <dt className={helpText}>Model</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{status?.embeddingModel ?? '—'}</dd>
          </div>
          <div>
            <dt className={helpText}>Dimensions</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{status?.dimensions ?? '—'}</dd>
          </div>
          <div>
            <dt className={helpText}>Vector search</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{status?.vectorSearch ?? '—'}</dd>
          </div>
          <div>
            <dt className={helpText}>Embedded</dt>
            <dd className="mt-1 font-semibold text-emerald-600">{status?.counts.embedded ?? '—'}</dd>
          </div>
          <div>
            <dt className={helpText}>Unembedded</dt>
            <dd className="mt-1 font-semibold text-amber-600">{status?.counts.unembedded ?? '—'}</dd>
          </div>
          <div>
            <dt className={helpText}>Total</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{status?.counts.total ?? '—'}</dd>
          </div>
        </dl>
        <div className="mt-6 flex gap-3">
          <Button onClick={() => reindex(false)} disabled={busy || !status?.embedderReady}>
            {busy ? 'Working…' : 'Embed missing'}
          </Button>
          <Button variant="ghost" onClick={() => reindex(true)} disabled={busy || !status?.embedderReady}>
            Full reindex
          </Button>
        </div>
        {!status?.embedderReady && (
          <p className={`mt-2 ${helpText}`}>Configure an embedder in the AI Credentials tab first.</p>
        )}
        {runResult && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{runResult}</p>}
      </div>

      <div className={card}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-semibold text-slate-900 dark:text-white">Jobs</h3>
          <select
            className="ml-auto h-8 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">All</option>
            <option value="embedded">Embedded</option>
            <option value="unembedded">Unembedded</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Embedded</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map((j) => (
                <tr key={j._id}>
                  <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                    {j.title} <span className={helpText}>· {j.company}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{j.status}</td>
                  <td className="px-3 py-2">
                    {j.embedded ? <span className="text-emerald-600">yes</span> : <span className="text-amber-600">no</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{j.embeddingModel ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="text-xs text-indigo-600 hover:underline" onClick={() => reembedOne(j._id)}>
                        Re-embed
                      </button>
                      {j.embedded && (
                        <button className="text-xs text-red-600 hover:underline" onClick={() => clearOne(j._id)}>
                          Clear
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className={`px-3 py-6 text-center ${helpText}`}>
                    No jobs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------

interface ManagedFile {
  publicId: string
  url: string
  bytes: number
  format: string | null
  createdAt: string | null
}

function FilesTab() {
  const [files, setFiles] = useState<ManagedFile[]>([])
  const [configured, setConfigured] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  function load() {
    setError(null)
    apiFetch('/admin/files')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load files.')
        const body = await res.json()
        setConfigured(body.configured)
        setFiles(body.files ?? [])
      })
      .catch((e) => setError(e.message))
  }

  useEffect(load, [])

  async function remove(publicId: string) {
    setError(null)
    try {
      const res = await apiFetch(`/admin/files?publicId=${encodeURIComponent(publicId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.')
    }
  }

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const token = getToken()
      const headers = new Headers()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const res = await fetch(`${API_BASE_URL}/admin/files`, { method: 'POST', headers, body: form })
      if (!res.ok) throw new Error('Upload failed.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  if (!configured) {
    return (
      <div className={card}>
        <p className={helpText}>Cloudinary isn't configured — set CLOUDINARY_* env vars to manage files.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <FormError message={error} />}
      <div className={card}>
        <label className="flex cursor-pointer items-center gap-3">
          <span className={fieldLabel}>Upload a file</span>
          <input
            type="file"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ''
            }}
            className="text-sm"
          />
          {uploading && <span className={helpText}>Uploading…</span>}
        </label>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {files.map((f) => (
                <tr key={f.publicId}>
                  <td className="px-3 py-2">
                    <a href={f.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                      {f.publicId}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{formatBytes(f.bytes)}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(f.createdAt)}</td>
                  <td className="px-3 py-2">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => remove(f.publicId)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan={4} className={`px-3 py-6 text-center ${helpText}`}>
                    No files.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Settings</h1>
      <p className={`mt-1 ${helpText}`}>Admin-only configuration for AI, vectors, and file storage.</p>
      <Tabs defaultValue="ai" className="mt-6">
        <TabsList>
          <TabsTrigger value="ai">AI Credentials</TabsTrigger>
          <TabsTrigger value="vectors">Vectors</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <TabsContent value="ai">
          <AiCredentialsTab />
        </TabsContent>
        <TabsContent value="vectors">
          <VectorsTab />
        </TabsContent>
        <TabsContent value="files">
          <FilesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
