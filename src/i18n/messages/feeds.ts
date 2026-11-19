export const feeds = {

  // FeedList
  'feeds.title': { fr: 'Flux', en: 'Feeds', zh: '订阅源'},
  'feeds.inbox': { fr: 'Boîte de réception', en: 'Inbox', zh: '收件箱'},
  'feeds.add': { fr: 'Flux', en: 'Feed', zh: '订阅源'},
  'feeds.theme': { fr: 'Thème', en: 'Theme', zh: '主题'},
  'feeds.colorMode': { fr: 'Mode de couleur', en: 'Color mode', zh: '颜色模式'},
  'feeds.rename': { fr: 'Renommer', en: 'Rename', zh: '重命名'},
  'feeds.markAllRead': { fr: 'Tout marquer comme lu', en: 'Mark all as read', zh: '全部标为已读'},
  'feeds.delete': { fr: 'Supprimer', en: 'Delete', zh: '删除'},
  'feeds.deleteFeed': { fr: 'Supprimer le flux', en: 'Delete Feed', zh: '删除订阅源'},
  'feeds.reEnableFeed': { fr: 'Réactiver le flux', en: 'Re-enable Feed', zh: '重新启用订阅源'},
  'feeds.deleteConfirm': {
    fr: 'Supprimer ${name} ? Tous les articles associés seront également supprimés.',
    en: 'Delete ${name}? All associated articles will also be deleted.',
    zh: '确定删除 ${name}？所有关联的文章也将被删除。'
  },
  'feeds.reEnableConfirm': {
    fr: 'Ce flux a été désactivé à la suite d’erreurs répétées. Le réactiver ?',
    en: 'This feed was disabled due to repeated errors. Re-enable it?',
    zh: '此订阅源因多次错误被禁用。是否重新启用？'
  },
  'feeds.enable': { fr: 'Activer', en: 'Enable', zh: '启用'},
  'feeds.bookmarks': { fr: 'À lire plus tard', en: 'Read Later', zh: '稍后阅读'},
  'feeds.likes': { fr: 'Aimés', en: 'Liked', zh: '已点赞'},
  'feeds.today': { fr: 'Aujourd’hui', en: 'Today', zh: '今天'},
  'feeds.history': { fr: 'Lus', en: 'Read', zh: '已读'},
  'feeds.fetch': { fr: 'Récupérer les articles', en: 'Fetch articles', zh: '获取文章'},
  'category.fetchAll': { fr: 'Récupérer tous les flux', en: 'Fetch all feeds', zh: '获取所有订阅源'},
  'feeds.reDetect': { fr: 'Redétecter le RSS', en: 'Re-detect RSS', zh: '重新检测 RSS'},
  'feeds.aiFilter': { fr: 'Filtre IA', en: 'AI filter', zh: 'AI 过滤'},
  'feeds.archiveImages': { fr: 'Archiver automatiquement les images', en: 'Auto-archive images', zh: '自动存档图片'},
  'feeds.aiFilterDescription': { fr: 'Masquer les articles de ${feed} qui ne correspondent pas à votre critère.', en: 'Hide articles from ${feed} that do not match your criterion.', zh: '自动隐藏 ${feed} 中不符合条件的文章。'},
  'feeds.aiFilterPlaceholder': { fr: 'p. ex. uniquement les articles sur l’auto-hébergement et la domotique. Pas de bavardage.', en: 'e.g. Only posts about self-hosting and home automation. Skip chit-chat.', zh: '例如：仅保留自托管和智能家居相关内容，排除闲聊。'},
  'feeds.aiFilterHint': { fr: 'Votre modèle local évalue chaque article. Laissez vide pour désactiver le filtre.', en: 'Your local model judges each article. Leave empty to disable the filter.', zh: '由本地模型判断每篇文章。留空则禁用过滤。'},
  'feeds.clips': { fr: 'Clips', en: 'Clips', zh: '剪藏'},
  'feeds.githubReleases': { fr: 'Versions GitHub', en: 'GitHub Releases', zh: 'GitHub 发布'},
  'feeds.clipArticle': { fr: 'Clipper un article', en: 'Clip Article', zh: '剪藏文章'},
  'feeds.articleUrlPlaceholder': { fr: 'Saisissez l’URL de l’article', en: 'Enter article URL', zh: '输入文章 URL'},
  'modal.clipExistsInFeed': {
    fr: 'Cet article existe déjà dans le flux « ',
    en: 'This article already exists in feed "',
    zh: '此文章已存在于订阅源「'
  },
  'modal.clipExistsInFeedSuffix': {
    fr: ' »',
    en: '"',
    zh: '」中'
  },
  'modal.clipViewArticle': {
    fr: 'Voir l’article',
    en: 'View article',
    zh: '查看文章'
  },
  'modal.clipAlreadyExists': {
    fr: 'Cet article est déjà enregistré dans Clips',
    en: 'This article is already saved in Clips',
    zh: '此文章已保存在剪藏中'
  },
  'modal.clipMoveToClips': { fr: 'Déplacer vers Clips', en: 'Move to Clips', zh: '移至剪藏'},
  'modal.clipContentPending': {
    fr: 'Article ajouté — son contenu est en cours de chargement',
    en: 'Article added — its content is still loading',
    zh: '已添加文章 — 正在获取正文'
  },

  // FeedErrorBanner - pipeline stages
  'feedError.stage.discovery': { fr: 'Détection RSS', en: 'RSS Discovery', zh: 'RSS 发现'},
  'feedError.stage.bridge': { fr: 'Bridge', en: 'Bridge', zh: '桥接'},
  'feedError.stage.fetch': { fr: 'Récupération', en: 'Fetch', zh: '获取'},
  'feedError.stage.parse': { fr: 'Analyse', en: 'Parse', zh: '解析'},

  // FeedErrorBanner - error explanations
  'feedError.noRssUrl': {
    fr: 'Impossible de détecter l’URL d’un flux RSS sur ce site. Il est possible que le site ne propose pas de RSS. Essayez « Redétecter le RSS » pour tenter une récupération via RSS Bridge.',
    en: 'Could not detect an RSS feed URL from this site. The site may not provide RSS. Try "Re-detect RSS" to attempt fetching via RSS Bridge.',
    zh: '无法从此站点检测到 RSS 订阅源 URL。该站点可能不提供 RSS。尝试「重新检测 RSS」以通过 RSS Bridge 获取。'
  },
  'feedError.flareSolverrFailed': {
    fr: 'Ce site est protégé par une détection de bots (p. ex. Cloudflare) et le contournement a échoué. Patientez un instant puis essayez « Réessayer la récupération ».',
    en: 'This site is protected by bot detection (e.g. Cloudflare) and bypass failed. Wait a moment and try "Retry Fetch".',
    zh: '此站点受机器人检测（如 Cloudflare）保护，绕过失败。请稍等片刻后尝试「重试获取」。'
  },
  'feedError.httpError': {
    fr: 'Le serveur a renvoyé une erreur HTTP (${code}). Le site est peut-être temporairement indisponible ou l’URL a peut-être changé.',
    en: 'The server returned HTTP error (${code}). The site may be temporarily down or the URL may have changed.',
    zh: '服务器返回 HTTP 错误（${code}）。站点可能暂时不可用或 URL 已更改。'
  },
  'feedError.parseFailed': {
    fr: 'Impossible d’analyser le XML du flux. Son format est peut-être corrompu ou ce n’est pas du RSS/Atom. Essayez « Redétecter le RSS » pour trouver une autre source de flux.',
    en: 'Could not parse the feed XML. The feed format may be broken or not RSS/Atom. Try "Re-detect RSS" to find an alternative feed source.',
    zh: '无法解析订阅源 XML。订阅源格式可能损坏或不是 RSS/Atom 格式。尝试「重新检测 RSS」查找替代订阅源。'
  },
  'feedError.cssBridgeFailed': {
    fr: 'Échec de l’extraction des articles par scraping avec sélecteur CSS. La structure du site a peut-être changé. Essayez « Redétecter le RSS » pour déduire à nouveau le sélecteur.',
    en: 'Failed to extract articles via CSS selector scraping. The site structure may have changed. Try "Re-detect RSS" to re-infer the selector.',
    zh: '通过 CSS 选择器抓取文章失败。站点结构可能已更改。尝试「重新检测 RSS」以重新推断选择器。'
  },
  'feedError.unknown': {
    fr: 'Une erreur inattendue s’est produite lors de la récupération du flux. Patientez un instant puis essayez « Réessayer la récupération ».',
    en: 'An unexpected error occurred while fetching the feed. Wait a moment and try "Retry Fetch".',
    zh: '获取订阅源时发生意外错误。请稍等片刻后尝试「重试获取」。'
  },

  // FeedErrorBanner - actions & states
  'feedError.reDetect': { fr: 'Redétecter le RSS', en: 'Re-detect RSS', zh: '重新检测 RSS'},
  'feedError.retry': { fr: 'Réessayer la récupération', en: 'Retry Fetch', zh: '重试获取'},
  'feedError.processing': { fr: 'Récupération des articles…', en: 'Fetching articles…', zh: '正在获取文章…'},

  // AddModal (unified)
  'modal.addNew': { fr: 'Commencer', en: 'Get Started', zh: '开始使用'},
  'modal.addFeedOption': { fr: 'Flux', en: 'Feed', zh: '订阅源'},
  'modal.addFeedDesc': { fr: 'Ajouter un flux RSS à partir d’une URL', en: 'Add an RSS feed from a URL', zh: '从 URL 添加 RSS 订阅源'},
  'modal.clipArticleOption': { fr: 'Clip', en: 'Clip', zh: '剪藏'},
  'modal.clipArticleDesc': { fr: 'Clipper un article à partir d’une URL', en: 'Clip an article from a URL', zh: '从 URL 剪藏文章'},
  'modal.addFolderOption': { fr: 'Dossier', en: 'Folder', zh: '文件夹'},
  'modal.addFolderDesc': { fr: 'Créer un dossier pour organiser les flux', en: 'Create a folder to organize feeds', zh: '创建文件夹来整理订阅源'},
  'modal.addFolder': { fr: 'Ajouter un dossier', en: 'Add Folder', zh: '添加文件夹'},
  'modal.folderNamePlaceholder': { fr: 'Nom du dossier', en: 'Folder name', zh: '文件夹名称'},
  'modal.create': { fr: 'Créer', en: 'Create', zh: '创建'},
  'modal.creating': { fr: 'Création…', en: 'Creating...', zh: '创建中...'},

  // FeedModal
  'modal.addFeed': { fr: 'Ajouter un flux', en: 'Add Feed', zh: '添加订阅源'},
  'modal.url': { fr: 'URL', en: 'URL', zh: 'URL'},
  'modal.discovering': { fr: 'Récupération…', en: 'Fetching...', zh: '获取中...'},
  'modal.namePlaceholder': { fr: 'Nom (détecté automatiquement)', en: 'Name (auto-detected)', zh: '名称（自动检测）'},
  'modal.cancel': { fr: 'Annuler', en: 'Cancel', zh: '取消'},
  'modal.adding': { fr: 'Ajout…', en: 'Adding...', zh: '添加中...'},
  'modal.add': { fr: 'Ajouter', en: 'Add', zh: '添加'},
  'modal.errorRssNotDetected': { fr: 'Impossible de détecter un flux RSS pour cette URL', en: 'RSS could not be detected for this URL', zh: '无法从此 URL 检测到 RSS'},
  'modal.errorAlreadyExists': { fr: 'Ce flux existe déjà', en: 'This feed already exists', zh: '此订阅源已存在'},
  'modal.errorHttpOrHttpsOnly': { fr: 'Seules les URL commençant par http:// ou https:// sont autorisées', en: 'Only http:// or https:// URLs are allowed', zh: '仅支持以 http:// 或 https:// 开头的 URL'},
  'modal.genericError': { fr: 'Une erreur s’est produite', en: 'An error occurred', zh: '发生错误'},
  'modal.step.rssDiscovery': { fr: 'Détection RSS', en: 'RSS discovery', zh: 'RSS 发现'},
  'modal.step.flaresolverr': { fr: 'Rendu JS', en: 'JS rendering', zh: 'JS 渲染'},
  'modal.step.rssBridge': { fr: 'RSS Bridge', en: 'RSS Bridge', zh: 'RSS 桥接'},
  'modal.step.cssSelector': { fr: 'Sélecteur CSS (LLM)', en: 'CSS Selector (LLM)', zh: 'CSS 选择器（LLM）'},
  'modal.step.done': { fr: 'Flux créé', en: 'Feed created', zh: '订阅源已创建'},
  'modal.step.completed': { fr: 'Terminé', en: 'Completed', zh: '已完成'},
  'modal.step.found': { fr: 'Trouvé', en: 'Found', zh: '已找到'},
  'modal.step.notFound': { fr: 'Non détecté à cette étape', en: 'Not detected at this step', zh: '此步骤未检测到'},
  'modal.step.skipped': { fr: 'Ignoré', en: 'Skipped', zh: '已跳过'},
  'modal.choiceTitle': { fr: 'Un flux RSS couvrant tout le site a été trouvé', en: 'Found a site-wide RSS feed', zh: '找到全站 RSS 订阅源'},
  'modal.choiceWholeSite': { fr: 'S’abonner à l’ensemble du site', en: 'Subscribe to the whole site', zh: '订阅整个站点'},
  'modal.choiceThisPage': { fr: 'S’abonner à cette page uniquement', en: 'Subscribe to this page only', zh: '仅订阅此页面'},
  'modal.errorPageExtract': { fr: 'Impossible d’extraire le contenu de cette page', en: 'Could not extract content from this page', zh: '无法从此页面提取内容'},

  // Settings
  'feeds.dateFormat': { fr: 'Date', en: 'Date', zh: '日期'},
  'feeds.dateRelative': { fr: 'Relative', en: 'Relative', zh: '相对'},
  'feeds.dateAbsolute': { fr: 'Absolue', en: 'Absolute', zh: '绝对'},
  'feeds.inactive': { fr: 'inactif', en: 'inactive', zh: '未活跃'},
  'metrics.articles': { fr: 'articles', en: 'articles', zh: '篇文章'},
  'metrics.perWeek': { fr: '/sem.', en: '/wk', zh: '/周'},
  'metrics.lastUpdated': { fr: 'dernier', en: 'last', zh: '最近'},
  'metrics.inactive': { fr: 'inactif', en: 'inactive', zh: '未活跃'},
  'metrics.chars': { fr: 'car.', en: 'chars', zh: '字符'},
  'metrics.preview': { fr: '12 articles · 2,1/sem. · il y a 3 j', en: '12 articles · 2.1/wk · 3d ago', zh: '12 篇文章 · 2.1/周 · 3 天前'},
  'refresh.action': { fr: 'Actualiser', en: 'Refresh', zh: '刷新'},
  'refresh.running': { fr: 'Récupération…', en: 'Fetching...', zh: '获取中...'},
  'refresh.done': { fr: '${count} nouveaux articles', en: '${count} new articles', zh: '${count} 篇新文章'},
  'refresh.upToDate': { fr: 'Aucun nouvel article', en: 'No new articles', zh: '没有新文章'},
  'refresh.failed': { fr: 'Échec de la récupération', en: 'Fetch failed', zh: '获取失败'},

  // Categories
  'category.add': { fr: 'Ajouter une catégorie', en: 'Add category', zh: '添加分类'},
  'category.namePlaceholder': { fr: 'Nom de la catégorie', en: 'Category name', zh: '分类名称'},
  'category.rename': { fr: 'Renommer', en: 'Rename', zh: '重命名'},
  'category.delete': { fr: 'Supprimer la catégorie', en: 'Delete category', zh: '删除分类'},
  'category.deleteConfirm': {
    fr: 'Supprimer ${name} ? Les flux seront déplacés à la racine.',
    en: 'Delete ${name}? Feeds will be moved to top.',
    zh: '确定删除 ${name}？订阅源将移至顶部。'
  },
  'category.markAllRead': { fr: 'Tout marquer comme lu', en: 'Mark all as read', zh: '全部标为已读'},
  'category.moveToCategory': { fr: 'Déplacer vers la catégorie', en: 'Move to category', zh: '移动到分类'},
  'category.uncategorized': { fr: 'Racine', en: 'Top', zh: '顶部'},

  // Multi-select
  'feeds.selectedCount': { fr: '${count} flux sélectionnés', en: '${count} feeds selected', zh: '已选择 ${count} 个'},
  'feeds.bulkMarkAllRead': { fr: 'Tout marquer comme lu', en: 'Mark all as read', zh: '全部标为已读'},
  'feeds.bulkMoveToCategory': { fr: 'Déplacer vers la catégorie', en: 'Move to category', zh: '移动到分类'},
  'feeds.bulkFetch': { fr: 'Récupérer les articles', en: 'Fetch articles', zh: '获取文章'},
  'feeds.bulkDelete': { fr: 'Supprimer ${count} flux', en: 'Delete ${count} feeds', zh: '删除 ${count} 个订阅源'},
  'feeds.bulkDeleteConfirm': {
    fr: 'Supprimer ${count} flux ? Tous les articles associés seront également supprimés.',
    en: 'Delete ${count} feeds? All associated articles will also be deleted.',
    zh: '确定删除 ${count} 个订阅源？所有关联的文章也将被删除。'
  },
} as const
