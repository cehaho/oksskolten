export const auth = {

  // Setup
  'setup.title': { ja: '初期設定', en: 'Initial Setup', zh: '初始设置'},
  'setup.subtitle': { ja: 'アカウントを作成して始めましょう', en: 'Create your account to get started', zh: '创建账户以开始使用'},
  'setup.confirmPassword': { ja: 'パスワード（確認）', en: 'Confirm password', zh: '确认密码'},
  'setup.submit': { ja: 'アカウントを作成', en: 'Create Account', zh: '创建账户'},
  'setup.creating': { ja: '作成中...', en: 'Creating...', zh: '创建中...'},
  'setup.passwordTooShort': { ja: 'パスワードは8文字以上にしてください', en: 'Password must be at least 8 characters', zh: '密码至少 8 个字符'},
  'setup.passwordMismatch': { ja: 'パスワードが一致しません', en: 'Passwords do not match', zh: '密码不匹配'},
  'setup.failed': { ja: 'アカウントの作成に失敗しました', en: 'Failed to create account', zh: '创建账户失败'},
  'setup.networkError': { ja: 'ネットワークエラー', en: 'Network error', zh: '网络错误'},

  // Login
  'login.title': { ja: 'ログイン', en: 'Sign in', zh: '登录'},
  'login.subtitle': { ja: 'メールアドレスでログイン', en: 'Sign in with your email', zh: '使用邮箱登录'},
  'login.email': { ja: 'メールアドレス', en: 'Email', zh: '邮箱'},
  'login.password': { ja: 'パスワード', en: 'Password', zh: '密码'},
  'login.submit': { ja: 'ログイン', en: 'Sign in', zh: '登录'},
  'login.loading': { ja: 'ログイン中...', en: 'Signing in...', zh: '登录中...'},
  'login.failed': { ja: 'ログインに失敗しました', en: 'Login failed', zh: '登录失败'},
  'login.networkError': { ja: 'ネットワークエラー', en: 'Network error', zh: '网络错误'},

  // Login — passkey
  'login.passkey': { ja: 'パスキーでログイン', en: 'Sign in with passkey', zh: '使用通行密钥登录'},
  'login.or': { ja: 'または', en: 'or', zh: '或'},
  'login.passkeyError': { ja: 'パスキー認証に失敗しました', en: 'Passkey authentication failed', zh: '通行密钥认证失败'},
  'login.github': { ja: 'GitHubでログイン', en: 'Sign in with GitHub', zh: '使用 GitHub 登录'},
  'login.githubError': { ja: 'GitHub認証に失敗しました', en: 'GitHub authentication failed', zh: 'GitHub 认证失败'},
  'login.oidc': { ja: '${name}でログイン', en: 'Sign in with ${name}', zh: '使用 ${name} 登录'},
  'login.oidcError': { ja: '${name}認証に失敗しました', en: '${name} authentication failed', zh: '${name} 认证失败'},
  'login.ssoError': { ja: '外部認証に失敗しました', en: 'External sign-in failed', zh: '外部登录失败'},

  // Password strength
  'password.tooShort': { ja: '8文字以上必要です', en: 'At least 8 characters required', zh: '至少需要 8 个字符'},
  'password.weak': { ja: '弱い', en: 'Weak', zh: '弱'},
  'password.fair': { ja: '普通', en: 'Fair', zh: '一般'},
  'password.strong': { ja: '強い', en: 'Strong', zh: '强'},
} as const
