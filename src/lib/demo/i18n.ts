import { isLocale, type Locale } from '../../i18n/index.js'

const dict = {
  'demo.defaultUser': { fr: 'Demo User', en: 'Demo User', zh: 'Demo User' },
  'demo.disabled': { fr: 'Non disponible dans la démo', en: 'Not available in demo', zh: '演示模式下不可用' },
  'demo.aiDisabled': { fr: 'Les fonctions d’IA nécessitent votre propre instance', en: 'AI features require your own instance', zh: 'AI 功能需要自托管实例' },
  'demo.sampleArticle': { fr: 'Article d’exemple', en: 'Sample Article', zh: '示例文章' },
  'demo.sampleArticleBody': { fr: 'Ceci est un article d’exemple généré pour la démo.', en: 'This is a sample article generated for the demo.', zh: '这是为演示生成的示例文章。' },
  'demo.chatReply': {
    fr: 'Bonjour ! Voici une démo d’Oksskolten.\n\nLa discussion vous permet de poser des questions à l’IA sur vos articles, de demander des résumés et d’explorer votre liste de lecture sous forme de conversation. Dans la version auto-hébergée, vous pouvez connecter :\n\n- **Anthropic** (Claude)\n- **Google** (Gemini)\n- **OpenAI** (GPT)\n\nPour commencer, lancez `docker compose up`. Essayez-la !',
    en: 'Hi there! This is a demo of Oksskolten.\n\nThe chat feature lets you ask AI questions about articles, request summaries, and explore your reading list conversationally. In the self-hosted version, you can connect:\n\n- **Anthropic** (Claude)\n- **Google** (Gemini)\n- **OpenAI** (GPT)\n\nGet started with `docker compose up`. Give it a try!',
    zh: '你好！这是 Oksskolten 的演示版。\n\n聊天功能可以让您就文章内容向 AI 提问、请求摘要，并以对话方式探索阅读列表。在自托管版本中，您可以连接：\n\n- **Anthropic** (Claude)\n- **Google** (Gemini)\n- **OpenAI** (GPT)\n\n使用 `docker compose up` 即可快速部署。欢迎试用！',
  },
  'demo.chatReply.recommend': {
    fr: 'Voici mes meilleures sélections du jour !\n\n1. [Allocation Optimizations in Go](/go.dev/blog/allocation-optimizations) — Les améliorations de l’analyse d’échappement de Go 1.26 réduisent nettement les allocations sur le tas. À lire absolument si la performance vous intéresse\n2. [Streaming AI Inference on Workers](/blog.cloudflare.com/workers-ai-streaming) — Comment exécuter de l’inférence d’IA en streaming sur Cloudflare Workers. De la technologie de pointe\n3. [What does it take to ship Rust in safety-critical?](/blog.rust-lang.org/2026/01/14/what-does-it-take-to-ship-rust-in-safety-critical/) — Défis et approches pour utiliser Rust dans les domaines critiques pour la sécurité\n\nToutes ces lectures valent le détour. Cliquez sur un article pour approfondir !',
    en: 'Here are my top picks for today!\n\n1. [Allocation Optimizations in Go](/go.dev/blog/allocation-optimizations) — Go 1.26\'s escape analysis improvements significantly reduce heap allocations. A must-read if you care about performance\n2. [Streaming AI Inference on Workers](/blog.cloudflare.com/workers-ai-streaming) — How to run AI inference on Cloudflare Workers with streaming. Cutting-edge stuff\n3. [What does it take to ship Rust in safety-critical?](/blog.rust-lang.org/2026/01/14/what-does-it-take-to-ship-rust-in-safety-critical/) — Challenges and approaches for using Rust in safety-critical domains\n\nAll great reads. Click on any article to dive deeper!',
    zh: '以下是今天的推荐！\n\n1. [Go 中的分配优化](/go.dev/blog/allocation-optimizations) — Go 1.26 的逃逸分析改进显著减少了堆分配。关注性能的话必读\n2. [在 Workers 上进行流式 AI 推理](/blog.cloudflare.com/workers-ai-streaming) — 如何在 Cloudflare Workers 上运行流式 AI 推理。前沿技术\n3. [在安全关键领域使用 Rust 需要什么？](/blog.rust-lang.org/2026/01/14/what-does-it-take-to-ship-rust-in-safety-critical/) — 在安全关键领域使用 Rust 的挑战和方法\n\n都是好文章。点击任何文章深入了解！',
  },
  'demo.chatReply.unread': {
    fr: 'J’ai passé vos articles non lus en revue ! Voici quelques sélections intéressantes :\n\n- [Experimental JSON v2 Package](/go.dev/blog/jsonv2-exp) — Le nouveau paquet JSON de Go, qui aborde autrement les points faibles de `encoding/json`\n- [Multi-agent workflows often fail. Here’s how to engineer ones that don’t.](/github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) — Des modèles de conception pour les systèmes multi-agents. Indispensable pour les développeurs d’IA\n- [Introducing Deno Sandbox](/deno.com/blog/introducing-deno-sandbox) — Le bac à sable de Deno. Idéal pour les développeurs soucieux de sécurité\n\nVous avez pas mal d’articles non lus. Jetez-y un œil quand vous aurez le temps !',
    en: 'I checked your unread articles! Here are some interesting picks:\n\n- [Experimental JSON v2 Package](/go.dev/blog/jsonv2-exp) — Go\'s new JSON package with a fresh approach to solving `encoding/json` pain points\n- [Multi-agent workflows often fail. Here\'s how to engineer ones that don\'t.](/github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) — Design patterns for multi-agent systems. Essential for AI developers\n- [Introducing Deno Sandbox](/deno.com/blog/introducing-deno-sandbox) — Deno\'s sandboxing feature. Great for security-conscious developers\n\nYou have quite a few unread articles. Check them out when you have time!',
    zh: '我检查了您的未读文章！以下是一些有趣的推荐：\n\n- [实验性 JSON v2 包](/go.dev/blog/jsonv2-exp) — Go 的新 JSON 包，采用全新方法解决 `encoding/json` 的痛点\n- [多智能体工作流经常失败。以下是成功的方法。](/github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) — 多智能体系统的设计模式。AI 开发者必读\n- [介绍 Deno Sandbox](/deno.com/blog/introducing-deno-sandbox) — Deno 的沙箱功能。安全意识强的开发者值得关注\n\n您还有不少未读文章。有空的时候看看！',
  },
  'demo.chatReply.trending': {
    fr: 'Voici ce qui fait la tendance dans vos flux :\n\n**IA × outils de développement**, c’est brûlant. [What’s new with GitHub Copilot coding agent](/github.blog/ai-and-ml/github-copilot/whats-new-with-github-copilot-coding-agent/) et [Streaming AI Inference on Workers](/blog.cloudflare.com/workers-ai-streaming) montrent l’IA intégrée au niveau de l’infrastructure\n\n**La concurrence entre environnements d’exécution** s’intensifie. [Deno 2.7](/deno.com/blog/v2.7) avec l’API Temporal, les optimisations de [Go 1.26](/go.dev/blog/go1.26), [Rust 1.92](/blog.rust-lang.org/2025/12/11/Rust-1.92.0) : tous évoluent régulièrement\n\n**La sécurité** est aussi bien présente, avec le [Cloudflare 2026 Internet Threat Report](/blog.cloudflare.com/2026-threat-report) et les discussions sur la cryptographie post-quantique\n\nVotre sélection de flux offre une excellente visibilité sur ce qui se passe !',
    en: 'Here\'s what\'s trending across your feeds:\n\n**AI × Developer Tools** is hot. [What\'s new with GitHub Copilot coding agent](/github.blog/ai-and-ml/github-copilot/whats-new-with-github-copilot-coding-agent/) and [Streaming AI Inference on Workers](/blog.cloudflare.com/workers-ai-streaming) show AI being integrated at the infrastructure level\n\n**Runtime competition** is heating up. [Deno 2.7](/deno.com/blog/v2.7) with Temporal API, [Go 1.26](/go.dev/blog/go1.26) optimizations, [Rust 1.92](/blog.rust-lang.org/2025/12/11/Rust-1.92.0) — all evolving steadily\n\n**Security** is prominent too, with [Cloudflare 2026 Internet Threat Report](/blog.cloudflare.com/2026-threat-report) and post-quantum cryptography discussions\n\nYour feed lineup gives great visibility into what\'s happening!',
    zh: '分析了您订阅源中的热门话题：\n\n**AI × 开发工具** 非常火热。[GitHub Copilot 编码智能体的最新进展](/github.blog/ai-and-ml/github-copilot/whats-new-with-github-copilot-coding-agent/) 和 [在 Workers 上进行流式 AI 推理](/blog.cloudflare.com/workers-ai-streaming) 展示了 AI 在基础设施层面的整合\n\n**运行时竞争** 也在升温。[Deno 2.7](/deno.com/blog/v2.7) 支持 Temporal API，[Go 1.26](/go.dev/blog/go1.26) 优化，[Rust 1.92](/blog.rust-lang.org/2025/12/11/Rust-1.92.0) 发布 — 各语言和运行时都在稳步进化\n\n**安全** 话题也很突出，[Cloudflare 2026 年互联网威胁报告](/blog.cloudflare.com/2026-threat-report) 和后量子密码学讨论\n\n您的订阅源阵容很棒，热门话题一目了然！',
  },
  'demo.chatReply.surprise': {
    fr: 'Voici quelque chose d’inattendu :\n\n[Build a dinosaur runner game with Deno, pt. 1](/deno.com/blog/build-a-game-with-deno-1)\n\nUn tutoriel pour créer avec Deno le jeu du dinosaure du navigateur. Une pause amusante au milieu des articles habituels sur l’infrastructure et le back-end.\n\nPar ailleurs, [16 Years of Go](/go.dev/blog/16years) est étonnamment intéressant : en revenant sur 16 ans d’histoire, on voit comment des fonctionnalités qui nous paraissent aujourd’hui évidentes sont apparues.\n\nParfait pour changer de rythme !',
    en: 'Here\'s something unexpected:\n\n[Build a dinosaur runner game with Deno, pt. 1](/deno.com/blog/build-a-game-with-deno-1)\n\nA tutorial on building the browser\'s dinosaur runner game with Deno. A fun break from the usual infrastructure and backend articles.\n\nAlso, [16 Years of Go](/go.dev/blog/16years) is surprisingly interesting — looking back at 16 years of history shows how features we take for granted today came to be.\n\nPerfect for a change of pace!',
    zh: '给您来点意想不到的：\n\n[用 Deno 构建恐龙跑步游戏，第 1 部分](/deno.com/blog/build-a-game-with-deno-1)\n\n一个关于用 Deno 构建浏览器恐龙跑步游戏的教程。在大量基础设施和后端文章中，这种有趣的文章令人耳目一新。\n\n另外，[Go 的 16 年](/go.dev/blog/16years) 也很有趣 — 回顾 16 年的历史，可以看到今天我们认为理所当然的功能是如何诞生的。\n\n换换脑子如何？',
  },
  'demo.chatReply.digest': {
    fr: 'Voici votre condensé de la semaine :\n\n## Go\n- [Go 1.26 is Released](/go.dev/blog/go1.26) — optimisations de l’analyse d’échappement et tests avec temps simulé\n- [Experimental JSON v2 Package](/go.dev/blog/jsonv2-exp) annoncé\n\n## Cloudflare\n- [Welcome to AI Week 2025](/blog.cloudflare.com/welcome-to-ai-week-2025) — inférence d’IA en streaming sur Workers\n- [Cloudflare Outage: February 20, 2026](/blog.cloudflare.com/cloudflare-outage-february-20-2026) — post-mortem publié\n\n## Kubernetes\n- [Kubernetes v1.35 Sneak Peek](/kubernetes.io/blog/2025/11/26/kubernetes-v1-35-sneak-peek) — Mutable PV Node Affinity et plus encore\n- [Ingress-NGINX Retirement Plan](/kubernetes.io/blog/2025/11/11/ingress-nginx-retirement) annoncé\n\n## Rust\n- [Announcing Rust 1.92.0](/blog.rust-lang.org/2025/12/11/Rust-1.92.0)\n- [What does it take to ship Rust in safety-critical?](/blog.rust-lang.org/2026/01/14/what-does-it-take-to-ship-rust-in-safety-critical/) fait parler de lui\n\n## Autres\n- [Deno Deploy is Generally Available](/deno.com/blog/deno-deploy-is-ga)\n- [Tailscale Services](/tailscale.com/blog/services-ga) et [Peer Relays](/tailscale.com/blog/peer-relays-ga) sont tous deux en disponibilité générale\n\nQuelle semaine chargée !',
    en: 'Here\'s your weekly digest:\n\n## Go\n- [Go 1.26 is Released](/go.dev/blog/go1.26) — escape analysis optimizations and fake time testing\n- [Experimental JSON v2 Package](/go.dev/blog/jsonv2-exp) announced\n\n## Cloudflare\n- [Welcome to AI Week 2025](/blog.cloudflare.com/welcome-to-ai-week-2025) — streaming AI inference on Workers\n- [Cloudflare Outage: February 20, 2026](/blog.cloudflare.com/cloudflare-outage-february-20-2026) — postmortem published\n\n## Kubernetes\n- [Kubernetes v1.35 Sneak Peek](/kubernetes.io/blog/2025/11/26/kubernetes-v1-35-sneak-peek) — Mutable PV Node Affinity and more\n- [Ingress-NGINX Retirement Plan](/kubernetes.io/blog/2025/11/11/ingress-nginx-retirement) announced\n\n## Rust\n- [Announcing Rust 1.92.0](/blog.rust-lang.org/2025/12/11/Rust-1.92.0)\n- [What does it take to ship Rust in safety-critical?](/blog.rust-lang.org/2026/01/14/what-does-it-take-to-ship-rust-in-safety-critical/) gaining attention\n\n## Other\n- [Deno Deploy is Generally Available](/deno.com/blog/deno-deploy-is-ga)\n- [Tailscale Services](/tailscale.com/blog/services-ga) and [Peer Relays](/tailscale.com/blog/peer-relays-ga) both reached GA\n\nBusy week!',
    zh: '这是您的每周摘要：\n\n## Go\n- [Go 1.26 发布](/go.dev/blog/go1.26) — 逃逸分析优化和假时间测试功能\n- [实验性 JSON v2 包](/go.dev/blog/jsonv2-exp) 发布\n\n## Cloudflare\n- [欢迎来到 AI 周 2025](/blog.cloudflare.com/welcome-to-ai-week-2025) — Workers 上的流式 AI 推理\n- [Cloudflare 故障：2026 年 2 月 20 日](/blog.cloudflare.com/cloudflare-outage-february-20-2026) — 事后分析已发布\n\n## Kubernetes\n- [Kubernetes v1.35 抢先看](/kubernetes.io/blog/2025/11/26/kubernetes-v1-35-sneak-peek) — 可变 PV 节点亲和性等\n- [Ingress-NGINX 退役计划](/kubernetes.io/blog/2025/11/11/ingress-nginx-retirement) 发布\n\n## Rust\n- [Rust 1.92.0 发布](/blog.rust-lang.org/2025/12/11/Rust-1.92.0)\n- [在安全关键领域使用 Rust 需要什么？](/blog.rust-lang.org/2026/01/14/what-does-it-take-to-ship-rust-in-safety-critical/) 引发关注\n\n## 其他\n- [Deno Deploy 正式发布](/deno.com/blog/deno-deploy-is-ga)\n- [Tailscale Services](/tailscale.com/blog/services-ga) 和 [Peer Relays](/tailscale.com/blog/peer-relays-ga) 均已 GA\n\n忙碌的一周！',
  },
  'demo.summaryReply': {
    fr: 'Ceci est une démo : aucun résumé d’IA réel n’est généré. Dans la version auto-hébergée, vous pouvez résumer des articles en un clic avec Anthropic, Gemini ou OpenAI.',
    en: 'This is a demo, so actual AI summaries are not generated. In the self-hosted version, you can summarize articles with one click using Anthropic, Gemini, or OpenAI.',
    zh: '这是演示版，不会生成实际的 AI 摘要。在自托管版本中，您可以使用 Anthropic、Gemini 或 OpenAI 一键摘要文章。',
  },
  'demo.translateReply': {
    fr: 'Ceci est une démo : aucune traduction d’IA réelle n’est générée. Dans la version auto-hébergée, vous pouvez choisir parmi 6 moteurs de traduction, dont Anthropic, Gemini, OpenAI, DeepL et Google Translate.',
    en: 'This is a demo, so actual AI translations are not generated. In the self-hosted version, you can choose from 6 translation engines including Anthropic, Gemini, OpenAI, DeepL, and Google Translate.',
    zh: '这是演示版，不会生成实际的 AI 翻译。在自托管版本中，您可以从 6 种翻译引擎中选择：Anthropic、Gemini、OpenAI、DeepL 和 Google 翻译。',
  },
} as const

type DemoMessageKey = keyof typeof dict

export function getLocale(): Locale {
  const v = localStorage.getItem('locale')
  return isLocale(v) ? v : 'en'
}

export function dt(key: DemoMessageKey): string {
  return dict[key][getLocale()]
}

/** Simulate SSE-like streaming by emitting text in small chunks with delays. */
export function streamText(text: string, onChunk: (chunk: string) => void): Promise<void> {
  return new Promise(resolve => {
    // Split into small chunks (CJK vs latin)
    const locale = getLocale()
    const chunkSize = locale === 'zh' ? 2 : 5
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize))
    }

    let idx = 0
    const interval = setInterval(() => {
      if (idx >= chunks.length) {
        clearInterval(interval)
        resolve()
        return
      }
      onChunk(chunks[idx])
      idx++
    }, 15) // 15ms per chunk → feels like fast streaming
  })
}
