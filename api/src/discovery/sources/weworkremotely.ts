import { XMLParser } from 'fast-xml-parser'
import { fetchWithPolicy } from '../fetchWithPolicy'
import type { JobSource, RawJobPosting } from '../types'

const WWR_FEED_URL = 'https://weworkremotely.com/categories/remote-programming-jobs.rss'

interface WwrRssItem {
  title?: string
  link?: string
  guid?: string
  pubDate?: string
  description?: string
  region?: string
}

export const weWorkRemotelySource: JobSource = {
  id: 'weworkremotely',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(WWR_FEED_URL)
    if (!res.ok) {
      throw new Error(`weworkremotely: unexpected status ${res.status}`)
    }
    const xml = await res.text()
    const parsed = new XMLParser().parse(xml)
    const rawItems = parsed?.rss?.channel?.item ?? []
    const items: WwrRssItem[] = Array.isArray(rawItems) ? rawItems : [rawItems]

    return items
      .filter((item): item is WwrRssItem & { link: string } => typeof item.link === 'string')
      .map((item) => {
        const fullTitle = item.title ?? 'Unknown company: Unknown title'
        const separatorIndex = fullTitle.indexOf(': ')
        const company = separatorIndex === -1 ? 'Unknown company' : fullTitle.slice(0, separatorIndex)
        const title =
          separatorIndex === -1 ? fullTitle : fullTitle.slice(separatorIndex + 2)

        return {
          sourceId: 'weworkremotely' as const,
          sourceJobId: item.guid ?? item.link,
          url: item.link,
          title,
          company,
          rawDescription: item.description ?? '',
          location: item.region ?? null,
          salaryMin: null,
          salaryMax: null,
          postedAt: item.pubDate ?? null,
        }
      })
  },
}
