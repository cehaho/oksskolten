---
paths:
  - "src/**"
  - "server/**"
---

# Language Rules

- Source code, comments, log output, and error messages must all be written in **English**
- User-visible text requiring i18n: register in the `src/i18n/messages/*.ts` dictionary (French, English and Chinese) and reference via `t()`. For demo mode, use `src/lib/demo/i18n.ts` `dt()`
- Date/time formatting: use `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` with locale, never hardcode
- Multilingual boilerplate patterns for web scraping (e.g. "Read more"): centralize in `server/lib/cleaner/boilerplate-text.ts`, never inline
- AI prompts: write in English, include response language instruction (`Respond in the user's language` etc.) within the prompt

## Files Allowed to Contain Non-English Text

These files may contain French, Chinese or other non-English text by nature. Do not hardcode non-English text in source files outside this list.

- `src/i18n/messages/*.ts` — UI i18n dictionary (`fr` / `en` / `zh` texts for every key)
- `src/lib/demo/i18n.ts` — Demo mode i18n dictionary
- `server/lib/cleaner/boilerplate-text.ts` — Multilingual boilerplate patterns for scraping
- `server/intelligence/stopwords.ts` — English/French stopwords ignored in article titles
- `src/data/articleFonts.ts` — Font sample text and CSS font names
- `server/providers/translate/markdown-to-tagged.ts` — CJK punctuation character set definitions
- `src/lib/demo/seed/*.json` — Demo seed data
- `*.test.ts` — Test data and fixtures
