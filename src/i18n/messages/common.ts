import { APP_NAME } from '../app-name.js'

export const common = {
  // Header
  'header.menu': { fr: 'Menu', en: 'Menu', zh: '菜单'},
  'header.back': { fr: 'Retour', en: 'Back', zh: '返回'},
  'header.modeSystem': { fr: 'Système', en: 'System', zh: '系统'},
  'header.modeDark': { fr: 'Sombre', en: 'Dark', zh: '深色'},
  'header.modeLight': { fr: 'Clair', en: 'Light', zh: '浅色'},
  'header.title': { fr: APP_NAME, en: APP_NAME, zh: APP_NAME },

  // Hint banners
  'hint.today': { fr: 'Articles classés selon votre activité. Vous pouvez aussi demander à l’IA « Que devrais-je lire aujourd’hui ? ».', en: 'Articles scored by your engagement. You can also ask the AI "What should I read today?"', zh: '根据您的互动评分的文章。您也可以问 AI「今天读什么？」' },
  'hint.inbox': { fr: 'La porte d’entrée d’Oksskolten, où ne figurent que les articles non lus. Une fois marqués comme lus, ils n’apparaissent plus dans la boîte de réception.', en: 'The front door of Oksskolten, where only unread articles live. Once marked as read, they won\'t appear in Inbox anymore.', zh: 'Oksskolten 的入口，只有未读文章。标为已读后将不再出现在收件箱中。' },
  'hint.bookmarks': { fr: 'Gardez des articles pour plus tard. Un moyen rapide de mettre de côté ce que vous voulez retrouver.', en: 'Keep articles for later. A quick way to save something you want to come back to.', zh: '保留文章以便稍后阅读。快速保存您想回来看的内容。' },
  'hint.likes': { fr: 'Les articles que vous avez aimés se trouvent ici. Les mentions J’aime améliorent aussi la recherche et le score des recommandations.', en: 'Articles you\'ve liked live here. Likes also boost search and recommendation scoring.', zh: '您点赞的文章在这里。点赞也会提升搜索和推荐评分。' },
  'hint.clips': { fr: 'Enregistrez des articles individuels à partir de leur URL, idéal pour les sources dont vous n’avez pas besoin de suivre le flux complet.', en: 'Save individual articles by URL — perfect for sources you don\'t need a full feed for.', zh: '通过 URL 保存单篇文章 — 适合不需要完整订阅的来源。' },
  'hint.history': { fr: 'Les articles que vous avez réellement ouverts et lus. Ceux écartés par « Marquer comme lu au défilement » n’y figurent pas : seuls les articles que vous avez ouverts sont conservés.', en: 'Articles you actually opened and read. Items swept away by "Auto-Mark As Read On Scroll" aren\'t included — only articles you tapped into.', zh: '您实际打开并阅读的文章。「滚动时自动标为已读」跳过的不包括在内 — 只有您点进去看的文章。' },
  'date.justNow': { fr: 'à l’instant', en: 'just now', zh: '刚刚'},

  // Sidebar menu
  'sidebar.settings': { fr: 'Réglages', en: 'Settings', zh: '设置'},

  // ConfirmDialog
  'confirm.cancel': { fr: 'Annuler', en: 'Cancel', zh: '取消'},

  // Logout
  'sidebar.logout': { fr: 'Se déconnecter', en: 'Log out', zh: '退出登录'},

  // Home page — time-based greetings
  'home.greeting.morning': { fr: 'Bonjour, {name}', en: 'Good morning, {name}', zh: '早上好，{name}'},
  'home.greeting.afternoon': { fr: 'Bon après-midi, {name}', en: 'Good afternoon, {name}', zh: '下午好，{name}'},
  'home.greeting.evening': { fr: 'Bonsoir, {name}', en: 'Good evening, {name}', zh: '晚上好，{name}'},
  // Home page — random fallback (outside greeting windows)
  'home.greeting.random.0': { fr: 'Qu’aimeriez-vous explorer ?', en: 'What would you like to explore?', zh: '想探索些什么？'},
  'home.greeting.random.1': { fr: 'Que souhaitez-vous lire aujourd’hui ?', en: 'What would you like to read today?', zh: '今天想读什么？'},
  'home.greeting.random.2': { fr: 'Comment puis-je vous aider ?', en: 'How can I help you?', zh: '有什么我能帮忙的？'},
  'home.greeting.random.3': { fr: 'Un sujet en tête ?', en: 'Any topics on your mind?', zh: '有什么感兴趣的话题吗？'},
  'home.greeting.random.4': { fr: 'Par où commencer ?', en: 'Where shall we start?', zh: '从哪里开始？'},
  'home.placeholder': { fr: 'Posez n’importe quelle question sur vos articles…', en: 'Ask anything about your articles...', zh: '随便问关于文章的问题...'},
  'home.chatHistory': { fr: 'Historique des discussions', en: 'Chat history', zh: '聊天历史'},
  // Command Palette
  'command.navigation': { fr: 'Navigation', en: 'Navigation', zh: '导航'},
  'command.actions': { fr: 'Actions', en: 'Actions', zh: '操作'},
  'command.feeds': { fr: 'Flux', en: 'Feeds', zh: '订阅源'},
  'command.appearance': { fr: 'Apparence', en: 'Appearance', zh: '外观'},
  'command.placeholder': { fr: 'Saisissez une commande ou une recherche…', en: 'Type a command or search...', zh: '输入命令或搜索...'},
  'command.noResults': { fr: 'Aucun résultat.', en: 'No results found.', zh: '未找到结果。'},
  'command.searchArticles': { fr: 'Rechercher des articles', en: 'Search articles', zh: '搜索文章'},
  'command.addFeed': { fr: 'Ajouter un flux', en: 'Add new feed', zh: '添加新订阅源'},
  'command.importOpml': { fr: 'Importer un OPML', en: 'Import OPML', zh: '导入 OPML'},
  'command.exportOpml': { fr: 'Exporter un OPML', en: 'Export OPML', zh: '导出 OPML'},
  'error.anthropicKeyNotSet': {
    fr: 'La clé d’API Anthropic n’est pas configurée.',
    en: 'Anthropic API key is not configured.',
    zh: 'Anthropic API 密钥未配置。'
  },
  'error.geminiKeyNotSet': {
    fr: 'La clé d’API Gemini n’est pas configurée.',
    en: 'Gemini API key is not configured.',
    zh: 'Gemini API 密钥未配置。'
  },
  'error.openaiKeyNotSet': {
    fr: 'La clé d’API OpenAI n’est pas configurée.',
    en: 'OpenAI API key is not configured.',
    zh: 'OpenAI API 密钥未配置。'
  },
  'error.googleTranslateKeyNotSet': {
    fr: 'La clé d’API Google Translate n’est pas configurée.',
    en: 'Google Translate API key is not configured.',
    zh: 'Google 翻译 API 密钥未配置。'
  },
  'error.deeplKeyNotSet': {
    fr: 'La clé d’API DeepL n’est pas configurée.',
    en: 'DeepL API key is not configured.',
    zh: 'DeepL API 密钥未配置。'
  },
  'error.summarizationFailed': {
    fr: 'Échec du résumé. Veuillez réessayer plus tard.',
    en: 'Summarization failed. Please try again later.',
    zh: '摘要生成失败。请稍后重试。'
  },
  'error.translationFailed': {
    fr: 'Échec de la traduction. Veuillez réessayer plus tard.',
    en: 'Translation failed. Please try again later.',
    zh: '翻译失败。请稍后重试。'
  },
  'error.goToSettings': {
    fr: 'Réglages',
    en: 'Settings',
    zh: '设置'
  },
  'error.setApiKeyFromSettings': {
    fr: ' pour configurer votre clé d’API.',
    en: ' to configure your API key.',
    zh: '中配置您的 API 密钥。'
  },

  // Search
  'search.title': { fr: 'Recherche', en: 'Search', zh: '搜索'},
  'search.placeholder': { fr: 'Rechercher des articles…', en: 'Search articles...', zh: '搜索文章...'},
  'search.noResults': { fr: 'Aucun article correspondant', en: 'No matching articles', zh: '没有匹配的文章'},
  'search.indexBuilding': { fr: 'Création de l’index de recherche…', en: 'Building search index…', zh: '正在构建搜索索引…'},
  'search.hint': { fr: '↑↓ naviguer · Entrée ouvrir · Échap fermer', en: '↑↓ navigate · Enter open · Esc close', zh: '↑↓ 导航 · Enter 打开 · Esc 关闭'},
  'search.filterBookmarked': { fr: 'À lire plus tard', en: 'Read Later', zh: '稍后阅读'},
  'search.filterLiked': { fr: 'Aimés', en: 'Liked', zh: '已点赞'},
  'search.filterUnread': { fr: 'Non lus', en: 'Unread', zh: '未读'},
  'search.period.today': { fr: 'Aujourd’hui', en: 'Today', zh: '今天'},
  'search.period.week': { fr: 'Semaine', en: 'Week', zh: '周'},
  'search.period.month': { fr: 'Mois', en: 'Month', zh: '月'},
  'about.version': { fr: 'Version', en: 'Version', zh: '版本'},
  'about.github': { fr: 'GitHub', en: 'GitHub', zh: 'GitHub'},
  'about.issues': { fr: 'Retours', en: 'Feedback', zh: '反馈'},
  'about.commit': { fr: 'Commit', en: 'Commit', zh: '提交'},
  'about.buildDate': { fr: 'Date de compilation', en: 'Build Date', zh: '构建日期'},

  // Toast
  'toast.fetchedArticles': { fr: '${name} : ${count} nouveaux articles récupérés', en: '${name}: Fetched ${count} new articles', zh: '${name}：获取了 ${count} 篇新文章'},
  'toast.noNewArticles': { fr: '${name} : aucun nouvel article', en: '${name}: No new articles', zh: '${name}：无新文章'},
  'toast.fetchError': { fr: '${name} : échec de la récupération', en: '${name}: Fetch failed', zh: '${name}：获取失败'},
  'toast.newVersion': { fr: 'Une nouvelle version est disponible', en: 'A new version is available', zh: '有新版本可用'},
  'toast.reload': { fr: 'Recharger', en: 'Reload', zh: '重新加载'},
  'hint.smart': { fr: 'Une recherche enregistrée qui se comporte comme un dossier : les nouveaux articles correspondant à la requête y apparaissent automatiquement.', en: 'A saved search that behaves like a folder: new articles matching the query appear here on their own.', zh: '保存的搜索会像文件夹一样：匹配查询的新文章会自动出现在这里。'},
  'hint.stories': { fr: 'Lorsque plusieurs flux rapportent le même événement, ils sont regroupés en une seule actualité, classée selon le nombre de sources qui l’ont couverte.', en: 'When several feeds report the same event they are folded into one story, ranked by how many sources covered it.', zh: '当多个订阅源报道同一事件时，它们会合并为一条新闻，按来源数量排序。'},
  'hint.recommended': { fr: 'Articles non lus classés selon le profil d’intérêts déduit de ce que vous aimez, mettez de côté et ouvrez. Consultez-le et ajustez-le dans Réglages → Vos centres d’intérêt.', en: 'Unread articles ranked by the interest profile learned from what you like, bookmark and open. Review and tune it under Settings → Your interests.', zh: '根据您点赞、收藏和打开的文章学习到的兴趣画像排序的未读文章。可在设置 → 我的兴趣中查看和调整。'},
} as const
