export const auth = {

  // Setup
  'setup.title': { fr: 'Configuration initiale', en: 'Initial Setup', zh: '初始设置'},
  'setup.subtitle': { fr: 'Créez votre compte pour commencer', en: 'Create your account to get started', zh: '创建账户以开始使用'},
  'setup.confirmPassword': { fr: 'Confirmer le mot de passe', en: 'Confirm password', zh: '确认密码'},
  'setup.submit': { fr: 'Créer le compte', en: 'Create Account', zh: '创建账户'},
  'setup.creating': { fr: 'Création…', en: 'Creating...', zh: '创建中...'},
  'setup.passwordTooShort': { fr: 'Le mot de passe doit contenir au moins 8 caractères', en: 'Password must be at least 8 characters', zh: '密码至少 8 个字符'},
  'setup.passwordMismatch': { fr: 'Les mots de passe ne correspondent pas', en: 'Passwords do not match', zh: '密码不匹配'},
  'setup.failed': { fr: 'Échec de la création du compte', en: 'Failed to create account', zh: '创建账户失败'},
  'setup.networkError': { fr: 'Erreur réseau', en: 'Network error', zh: '网络错误'},

  // Login
  'login.title': { fr: 'Se connecter', en: 'Sign in', zh: '登录'},
  'login.subtitle': { fr: 'Connectez-vous avec votre adresse e-mail', en: 'Sign in with your email', zh: '使用邮箱登录'},
  'login.email': { fr: 'E-mail', en: 'Email', zh: '邮箱'},
  'login.password': { fr: 'Mot de passe', en: 'Password', zh: '密码'},
  'login.submit': { fr: 'Se connecter', en: 'Sign in', zh: '登录'},
  'login.loading': { fr: 'Connexion…', en: 'Signing in...', zh: '登录中...'},
  'login.failed': { fr: 'Échec de la connexion', en: 'Login failed', zh: '登录失败'},
  'login.networkError': { fr: 'Erreur réseau', en: 'Network error', zh: '网络错误'},

  // Login — passkey
  'login.passkey': { fr: 'Se connecter avec une clé d’accès', en: 'Sign in with passkey', zh: '使用通行密钥登录'},
  'login.or': { fr: 'ou', en: 'or', zh: '或'},
  'login.passkeyError': { fr: 'Échec de l’authentification par clé d’accès', en: 'Passkey authentication failed', zh: '通行密钥认证失败'},
  'login.github': { fr: 'Se connecter avec GitHub', en: 'Sign in with GitHub', zh: '使用 GitHub 登录'},
  'login.githubError': { fr: 'Échec de l’authentification GitHub', en: 'GitHub authentication failed', zh: 'GitHub 认证失败'},
  'login.oidc': { fr: 'Se connecter avec ${name}', en: 'Sign in with ${name}', zh: '使用 ${name} 登录'},
  'login.oidcError': { fr: 'Échec de l’authentification ${name}', en: '${name} authentication failed', zh: '${name} 认证失败'},
  'login.ssoError': { fr: 'Échec de la connexion externe', en: 'External sign-in failed', zh: '外部登录失败'},

  // Password strength
  'password.tooShort': { fr: 'Au moins 8 caractères requis', en: 'At least 8 characters required', zh: '至少需要 8 个字符'},
  'password.weak': { fr: 'Faible', en: 'Weak', zh: '弱'},
  'password.fair': { fr: 'Moyen', en: 'Fair', zh: '一般'},
  'password.strong': { fr: 'Fort', en: 'Strong', zh: '强'},
} as const
