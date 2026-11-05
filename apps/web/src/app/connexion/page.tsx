import { getTranslations } from 'next-intl/server';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import { Brand } from '@/components/brand';
import { ThemeSwitch } from '@/components/theme-switch';
import { LoginForm } from '@/components/login-form';
export const metadata = { title: 'Connexion' };
export default async function LoginPage() {
  const t = await getTranslations('Login');
  const appName = process.env.APP_NAME || 'JobPilot';
  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="story-heading">
        <Brand name={appName} inverse />
        <div className="story-content">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 id="story-heading">{t('hero')}</h1>
          <p className="story-description">{t('intro')}</p>
          <div className="journey-art" aria-hidden="true">
            <div className="journey-orbit orbit-one" />
            <div className="journey-orbit orbit-two" />
            <div className="journey-orbit orbit-three" />
            <div className="journey-arrow">
              <ArrowUpRight size={54} strokeWidth={1.3} />
            </div>
            <span className="orbit-dot" />
          </div>
        </div>
        <p className="story-footer">
          <LockKeyhole size={14} aria-hidden="true" />
          {t('privacy')}
        </p>
      </section>
      <section className="login-panel" aria-labelledby="login-heading">
        <div className="login-topbar">
          <span className="mobile-brand">
            <Brand name={appName} />
          </span>
          <ThemeSwitch />
        </div>
        <div className="login-box">
          <span className="login-kicker" aria-hidden="true">
            01 / {appName}
          </span>
          <h2 id="login-heading">{t('welcome')}</h2>
          <p className="login-description">{t('description')}</p>
          <LoginForm />
          <p className="login-security">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            {t('secure')}
          </p>
        </div>
        <span className="login-bottom-brand" aria-hidden="true">
          {appName} © {new Date().getFullYear()}
        </span>
      </section>
    </main>
  );
}
