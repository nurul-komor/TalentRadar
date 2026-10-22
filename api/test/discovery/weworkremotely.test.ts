import { describe, it, expect, vi, afterEach } from 'vitest'
import { weWorkRemotelySource } from '../../src/discovery/sources/weworkremotely'

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>We Work Remotely</title>
    <item>
      <title>A.Team: Senior Independent Software Developer ($90-$170/hr)</title>
      <region>Anywhere in the World</region>
      <category>Full-Stack Programming</category>
      <description>&lt;p&gt;Join our team&lt;/p&gt;</description>
      <pubDate>Sun, 16 Jun 2024 17:30:51 +0000</pubDate>
      <guid>https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer</guid>
      <link>https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer</link>
    </item>
  </channel>
</rss>`

describe('weWorkRemotelySource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses the RSS feed and splits "Company: Title" from the item title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_RSS, { status: 200 })))

    const jobs = await weWorkRemotelySource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'weworkremotely',
        sourceJobId: 'https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer',
        url: 'https://weworkremotely.com/remote-jobs/a-team-senior-independent-software-developer',
        title: 'Senior Independent Software Developer ($90-$170/hr)',
        company: 'A.Team',
        rawDescription: '<p>Join our team</p>',
        location: 'Anywhere in the World',
        salaryMin: null,
        salaryMax: null,
        postedAt: 'Sun, 16 Jun 2024 17:30:51 +0000',
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(weWorkRemotelySource.fetchJobs()).rejects.toThrow('503')
  })
})
