import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseHtml } from './contentWorker.js'
import { extractAnchoredContentHtml, isBotBlockPage, stripHeavyTags } from './content.js'
import { convertHtmlToMarkdown, markdownToExcerpt } from './markdown-utils.js'

// ---------------------------------------------------------------------------
// Mocks — these mock modules used by contentWorker.ts (parseHtml)
// ---------------------------------------------------------------------------

const mockPreClean = vi.fn()
const mockPostClean = vi.fn()
vi.mock('../lib/cleaner/index.js', () => ({
  preClean: (...args: unknown[]) => mockPreClean(...args),
  postClean: (...args: unknown[]) => mockPostClean(...args),
}))

const mockFindBestContentBlock = vi.fn()
vi.mock('../lib/cleaner/content-scorer.js', () => ({
  findBestContentBlock: (...args: unknown[]) => mockFindBestContentBlock(...args),
}))

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function articleHtml(body: string, opts?: { ogImage?: string; title?: string }) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${opts?.title ?? 'Test'}</title>
  ${opts?.ogImage ? `<meta property="og:image" content="${opts.ogImage}"/>` : ''}
</head>
<body>
  <article>
    ${body}
  </article>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Tests — parseHtml (pure DOM processing, no network I/O)
// ---------------------------------------------------------------------------

describe('parseHtml', () => {
  beforeEach(() => {
    mockPreClean.mockReset()
    mockPostClean.mockReset()
    mockFindBestContentBlock.mockReset().mockReturnValue(null)
  })

  describe('embedded videos', () => {
    const prose = Array(6).fill('<p>Parasolid has sat at the centre of CAD kernels for decades, and this paragraph is here so Readability treats the page as a real article.</p>').join('\n')

    it('keeps a YouTube embed as a poster linking to the video', () => {
      const html = articleHtml(
        `${prose}<figure><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Parasolid history"></iframe><figcaption>A short history</figcaption></figure>${prose}`,
      )

      const result = parseHtml({ html, articleUrl: 'https://blogs.example.com/parasolid' })

      expect(result.fullText).toContain(
        '[![Parasolid history](https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
      )
      expect(result.fullText).toContain('A short history')
    })

    it('falls back to the provider name when the embed carries no title', () => {
      const html = articleHtml(`${prose}<iframe src="https://player.vimeo.com/video/76979871"></iframe>${prose}`)

      const result = parseHtml({ html, articleUrl: 'https://blogs.example.com/vimeo' })

      // Vimeo serves no predictable poster, so the card is a plain link.
      expect(result.fullText).toContain('[Vimeo](https://vimeo.com/76979871)')
    })

    it('does not let an embed title break out of the link syntax', () => {
      const html = articleHtml(
        `${prose}<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="A [bracketed] title"></iframe>${prose}`,
      )

      const result = parseHtml({ html, articleUrl: 'https://blogs.example.com/brackets' })

      expect(result.fullText).toContain('[![A \\[bracketed\\] title](https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg)]')
    })

    it('still drops iframes that are not videos', () => {
      const html = articleHtml(`${prose}<iframe src="https://ads.example.com/banner"></iframe>${prose}`)

      const result = parseHtml({ html, articleUrl: 'https://blogs.example.com/ads' })

      expect(result.fullText).not.toContain('ads.example.com')
    })
  })

  it('extracts article text via Readability', async () => {
    const html = articleHtml('<p>This is a test article with enough text content for Readability to extract.</p>')

    const result = parseHtml({ html, articleUrl: 'https://example.com/post-1' })

    expect(result.fullText).toContain('test article')
    expect(result.fullText.length).toBeGreaterThan(0)
  })

  it('extracts og:image from meta tag', async () => {
    const html = articleHtml(
      '<p>Article content for extraction and processing.</p>',
      { ogImage: '/images/og.png' },
    )

    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.ogImage).toBe('https://example.com/images/og.png')
  })

  it('resolves relative og:image URLs', async () => {
    const html = articleHtml(
      '<p>Some article text content for readability.</p>',
      { ogImage: '../img/hero.jpg' },
    )


    const result = parseHtml({ html, articleUrl: 'https://example.com/blog/post' })

    expect(result.ogImage).toMatch(/^https:\/\/example\.com/)
  })

  it('returns null ogImage when not present', async () => {
    const html = articleHtml('<p>No og image in this article text content.</p>')


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.ogImage).toBeNull()
  })

  it('generates excerpt from extracted text', async () => {
    const longText = 'A'.repeat(300)
    const html = articleHtml(`<p>${longText}</p>`)


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.excerpt).not.toBeNull()
    expect(result.excerpt!.length).toBeLessThanOrEqual(200)
  })

  it('calls preClean before Readability', async () => {
    const html = articleHtml('<p>Article content for pre-clean testing purposes.</p>')


    parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(mockPreClean).toHaveBeenCalledTimes(1)
    const doc = mockPreClean.mock.calls[0][0]
    expect(doc).toBeDefined()
    expect(typeof doc.querySelector).toBe('function')
  })

  it('calls postClean after Readability', async () => {
    const html = articleHtml('<p>Article content for post-clean testing purposes.</p>')


    parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(mockPostClean).toHaveBeenCalledTimes(1)
  })

  it('continues with original HTML when preClean throws (fail-open)', async () => {
    const html = articleHtml('<p>Article content with fail open pre-clean behavior.</p>')
    mockPreClean.mockImplementation(() => { throw new Error('preClean crash') })


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toContain('fail open')
  })

  it('continues with Readability output when postClean throws (fail-open)', async () => {
    const html = articleHtml('<p>Article content with fail open post-clean behavior.</p>')
    mockPostClean.mockImplementation(() => { throw new Error('postClean crash') })


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toContain('fail open')
  })

  it('uses content-scorer result when significantly larger than Readability', async () => {
    const shortContent = '<p>Short.</p>'
    const longContent = 'Very long content block. '.repeat(100)

    const html = `<!DOCTYPE html><html><head><title>T</title></head>
<body><article>${shortContent}</article><div id="main">${longContent}</div></body></html>`

    mockFindBestContentBlock.mockImplementation((doc: Document) => {
      const el = doc.querySelector('#main')
      if (!el) return null
      return {
        el,
        pRatio: 0.5,
        textLen: longContent.length,
      }
    })


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toContain('Very long content block')
  })

  it('keeps Readability result when content-scorer pRatio is too low', async () => {
    const html = articleHtml('<p>Good article content for Readability extraction here.</p>')

    mockFindBestContentBlock.mockReturnValue({
      el: { textContent: 'x', innerHTML: '<p>x</p>' },
      pRatio: 0.1,
      textLen: 10000,
    })


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toContain('Good article content')
  })

  it('throws when Readability fails to extract content', async () => {
    const html = '<html><head></head><body></body></html>'


    expect(() => parseHtml({ html, articleUrl: 'https://example.com/empty' }))
      .toThrow('could not extract')
  })

  it('simplifies picture elements with img child', async () => {
    const html = articleHtml(`
      <picture>
        <source srcset="https://example.com/large.webp 1200w" type="image/webp"/>
        <img src="https://example.com/photo.jpg" srcset="https://example.com/small.jpg 400w, https://example.com/large.jpg 800w" alt="Photo"/>
      </picture>
      <p>Article text content around the picture element.</p>
    `)


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toMatch(/!\[.*\]\(https:\/\/example\.com\/photo\.jpg\)/)
    expect(result.fullText).not.toContain('srcset')
    expect(result.fullText).not.toContain('<picture')
    expect(result.fullText).not.toContain('<source')
  })

  it('extracts first srcset URL when img has no src', async () => {
    const html = articleHtml(`
      <picture>
        <img srcset="https://example.com/first.jpg 400w, https://example.com/second.jpg 800w" alt="Test"/>
      </picture>
      <p>Article text content with a picture element that has no src.</p>
    `)


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toContain('first.jpg')
  })

  it('creates img from source srcset when picture has no img child', async () => {
    const html = articleHtml(`
      <picture>
        <source srcset="https://example.com/from-source.jpg 600w"/>
      </picture>
      <p>Article content with picture element without img child element.</p>
    `)


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).toContain('from-source.jpg')
  })

  it('removes picture element when no img and no source srcset', async () => {
    const html = articleHtml(`
      <picture>
        <source type="image/webp"/>
      </picture>
      <p>Article content where picture has no usable image source.</p>
    `)


    const result = parseHtml({ html, articleUrl: 'https://example.com/post' })

    expect(result.fullText).not.toContain('<picture')
  })

  it('passes cleanerConfig to preClean and postClean', async () => {
    const html = articleHtml('<p>Article content to test cleaner config passing.</p>')

    const config = { preCleanSelectors: ['.ad'], postCleanSelectors: ['.nav'] } as any


    parseHtml({ html, articleUrl: 'https://example.com/post', cleanerConfig: config })

    expect(mockPreClean).toHaveBeenCalledWith(expect.any(Object), config)
    expect(mockPostClean).toHaveBeenCalledWith(expect.any(Object), config)
  })

  it('resolves relative img src URLs against article URL', async () => {
    const html = articleHtml(`
      <picture>
        <img src="/images/relative.jpg" alt="Relative"/>
      </picture>
      <p>Article content with relative image URL for resolution.</p>
    `)


    const result = parseHtml({ html, articleUrl: 'https://example.com/blog/post' })

    expect(result.fullText).toContain('https://example.com/images/relative.jpg')
  })
})

describe('extractAnchoredContentHtml', () => {
  it('extracts only the targeted anchored section', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Changelog</title></head>
<body>
  <main>
    <h2 id="2-1-75">2.1.75</h2>
    <p>Previous release notes that should be excluded.</p>
    <h2 id="2-1-74">2.1.74</h2>
    <p>Target release notes with the content we want.</p>
    <ul><li>Relevant bullet</li></ul>
    <h2 id="2-1-73">2.1.73</h2>
    <p>Next release notes that should also be excluded.</p>
  </main>
</body>
</html>`

    const extracted = extractAnchoredContentHtml(html, 'https://example.com/changelog#2-1-74')

    expect(extracted).toContain('Target release notes')
    expect(extracted).toContain('Relevant bullet')
    expect(extracted).not.toContain('Previous release notes')
    expect(extracted).not.toContain('Next release notes')
  })

  it('returns original html when anchor target is missing', () => {
    const html = articleHtml('<p>Original content.</p>')

    expect(extractAnchoredContentHtml(html, 'https://example.com/post#missing')).toBe(html)
  })

  it('uses the nearest heading when the id is on a nested element', () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <main>
    <h2>2.1.75 <a id="2-1-75"></a></h2>
    <p>Previous section.</p>
    <h2>2.1.74 <a id="2-1-74"></a></h2>
    <p>Target section.</p>
    <h2>2.1.73 <a id="2-1-73"></a></h2>
    <p>Next section.</p>
  </main>
</body>
</html>`

    const extracted = extractAnchoredContentHtml(html, 'https://example.com/changelog#2-1-74')

    expect(extracted).toContain('Target section')
    expect(extracted).not.toContain('Previous section')
    expect(extracted).not.toContain('Next section')
  })

  it('keeps nested subheadings inside the targeted section', () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <main>
    <h2 id="2-1-74">2.1.74</h2>
    <p>Intro for target section.</p>
    <h3 id="details">Details</h3>
    <p>Nested details that should stay.</p>
    <h2 id="2-1-73">2.1.73</h2>
    <p>Next section.</p>
  </main>
</body>
</html>`

    const extracted = extractAnchoredContentHtml(html, 'https://example.com/changelog#2-1-74')

    expect(extracted).toContain('Intro for target section')
    expect(extracted).toContain('Nested details that should stay')
    expect(extracted).not.toContain('Next section')
  })

  it('handles role heading sections as boundaries', () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <main>
    <div role="heading" aria-level="2" id="2-1-74">2.1.74</div>
    <p>Target section.</p>
    <div role="heading" aria-level="2" id="2-1-73">2.1.73</div>
    <p>Next section.</p>
  </main>
</body>
</html>`

    const extracted = extractAnchoredContentHtml(html, 'https://example.com/changelog#2-1-74')

    expect(extracted).toContain('Target section')
    expect(extracted).not.toContain('Next section')
  })
})

describe('stripHeavyTags', () => {
  it('removes shell elements before readability', () => {
    const html = `
<header><p>Header</p></header>
<nav><p>Nav</p></nav>
<article><p>Body</p></article>
<aside><p>Aside</p></aside>
<footer><p>Footer</p></footer>`

    const stripped = stripHeavyTags(html)

    expect(stripped).toContain('<article><p>Body</p></article>')
    expect(stripped).not.toContain('Header')
    expect(stripped).not.toContain('Nav')
    expect(stripped).not.toContain('Aside')
    expect(stripped).not.toContain('Footer')
  })
})

describe('isBotBlockPage', () => {
  it.each([
    'Your submission has been received',
    'Something went wrong while submitting the form',
    'Please verify you are a human',
    'Checking your browser before accessing',
    'Enable JavaScript and cookies to continue',
    'Just a moment...',
    'Attention Required! | Cloudflare',
    'Access Denied - You do not have permission',
    "You've been blocked by network security. If you think you've been blocked by mistake, file a ticket below and we'll look into it.",
  ])('detects bot-block pattern: %s', (text) => {
    expect(isBotBlockPage(text)).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isBotBlockPage('CHECKING YOUR BROWSER')).toBe(true)
    expect(isBotBlockPage('access DENIED')).toBe(true)
  })

  it('returns false for normal article text', () => {
    expect(isBotBlockPage('This is a normal blog post about JavaScript frameworks.')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isBotBlockPage('')).toBe(false)
  })

  it('detects pattern embedded in larger HTML text', () => {
    const html = '<div class="wrapper"><h1>Security Check</h1><p>Please verify you are a human to continue browsing.</p></div>'
    expect(isBotBlockPage(html)).toBe(true)
  })

  // Seen on glitz.paris: the consent modal outweighs the paywalled teaser.
  it('detects a cookie consent wall extracted as the article', () => {
    const wall = '##### Paramétrez vos cookies\n\nNous utilisons des cookies pour vous offrir une expérience de navigation personnalisée, sécurisée et mesurer l\'audience.'
    expect(isBotBlockPage(wall)).toBe(true)
    expect(isBotBlockPage('We use cookies to improve your experience. Manage your cookie settings.')).toBe(true)
  })

  it('keeps a long article that ends with a cookie notice', () => {
    const article = 'A real paragraph of reporting with enough substance to stand on its own. '.repeat(40)
      + 'We use cookies to measure our audience.'
    expect(isBotBlockPage(article)).toBe(false)
  })
})

describe('convertHtmlToMarkdown', () => {
  it('converts simple HTML to markdown', () => {
    const html = '<p>Hello world</p>'
    const md = convertHtmlToMarkdown(html)
    expect(md).toContain('Hello world')
  })

  it('converts links to markdown links', () => {
    const html = '<a href="https://example.com">Example</a>'
    const md = convertHtmlToMarkdown(html)
    expect(md).toContain('[Example](https://example.com)')
  })

  it('converts br tags to line breaks', () => {
    const html = 'Line one<br /><br />Line two'
    const md = convertHtmlToMarkdown(html)
    expect(md).toContain('Line one')
    expect(md).toContain('Line two')
  })

  it('converts mixed HTML with links, line breaks, and nested spans', () => {
    const html = '<a href="https://example.com/tag">#topic</a><br /><br />First paragraph text.<br /><span><span>&nbsp;</span>Second paragraph with nested spans and details.</span>'
    const md = convertHtmlToMarkdown(html)
    expect(md).toContain('#topic')
    expect(md).toContain('First paragraph text.')
    expect(md).toContain('Second paragraph')
    expect(md).not.toContain('<span>')
    expect(md).not.toContain('<br')
  })

  it('handles empty HTML', () => {
    const md = convertHtmlToMarkdown('')
    expect(md.trim()).toBe('')
  })

  it('passes through plain text without mangling', () => {
    const text = 'This is plain text without any HTML tags.\nSecond line here.'
    const md = convertHtmlToMarkdown(text)
    expect(md).toBe(text)
  })

  it('passes through Markdown without escaping syntax', () => {
    const markdown = '## Heading\n\nSome **bold** text and [a link](https://example.com).'
    const md = convertHtmlToMarkdown(markdown)
    expect(md).toBe(markdown)
    expect(md).not.toContain('\\*')
    expect(md).not.toContain('\\[')
    expect(md).not.toContain('\\#')
  })
})

describe('markdownToExcerpt', () => {
  it('strips markdown images', () => {
    const md = '![alt text](https://example.com/img.jpg) Some text after.'
    expect(markdownToExcerpt(md)).toBe('Some text after.')
  })

  it('converts markdown links to plain text', () => {
    const md = 'Read [this article](https://example.com) for more info.'
    expect(markdownToExcerpt(md)).toBe('Read this article for more info.')
  })

  it('truncates to 200 characters by default', () => {
    const md = 'A'.repeat(300)
    const excerpt = markdownToExcerpt(md)!
    expect(excerpt.length).toBe(200)
  })

  it('accepts custom max length', () => {
    const md = 'A'.repeat(300)
    const excerpt = markdownToExcerpt(md, 100)!
    expect(excerpt.length).toBe(100)
  })

  it('returns null for empty markdown', () => {
    expect(markdownToExcerpt('')).toBeNull()
  })

  it('collapses whitespace', () => {
    const md = 'Line one.\n\nLine two.  Spaces.'
    expect(markdownToExcerpt(md)).toBe('Line one. Line two. Spaces.')
  })

  it('drops heading markers', () => {
    const md = '## SOLIDWORKS Downloads\n\nAccess the latest release.\n\n### FAQ\n\nAnswers to common questions.'
    expect(markdownToExcerpt(md)).toBe('SOLIDWORKS Downloads Access the latest release. FAQ Answers to common questions.')
  })

  it('unwraps emphasis, code and strikethrough', () => {
    const md = 'A **bold** claim, an *italic* one, __also bold__, ~~dropped~~ and `code()`.'
    expect(markdownToExcerpt(md)).toBe('A bold claim, an italic one, also bold, dropped and code().')
  })

  it('drops list markers, quotes and thematic breaks', () => {
    const md = '> Quoted line\n\n- First item\n- Second item\n\n1. Numbered\n\n---\n\nEnd.'
    expect(markdownToExcerpt(md)).toBe('Quoted line First item Second item Numbered End.')
  })

  it('restores characters Turndown escaped', () => {
    // Turndown writes \* for a literal asterisk in the source HTML.
    const md = '\\*Model courtesy of Develop LLC. 50\\% off \\[sic\\].'
    expect(markdownToExcerpt(md)).toBe('*Model courtesy of Develop LLC. 50\\% off [sic].')
  })

  it('leaves a lone asterisk alone instead of eating the text after it', () => {
    const md = 'Rates from 3* to 5* hotels.'
    expect(markdownToExcerpt(md)).toBe('Rates from 3* to 5* hotels.')
  })

  it('truncates after markdown is stripped, not before', () => {
    const md = `### Heading\n\n${'A'.repeat(300)}`
    expect(markdownToExcerpt(md, 20)).toBe('Heading ' + 'A'.repeat(12))
  })
})
