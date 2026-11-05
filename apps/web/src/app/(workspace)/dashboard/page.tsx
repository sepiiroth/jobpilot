import { CollectionPanel } from '@/components/collection-panel';
import { getTranslations } from 'next-intl/server';
import {
  ArrowUpRight,
  FileUser,
  Search,
  Sparkles,
  Compass,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
export const metadata = { title: 'Tableau de bord' };
export default async function Dashboard() {
  const t = await getTranslations('Dashboard');
  const common = await getTranslations('Common');
  const cards = [
    {
      icon: FileUser,
      title: 'resumeTitle',
      description: 'resumeDescription',
      number: '01',
    },
    {
      icon: Search,
      title: 'searchTitle',
      description: 'searchDescription',
      number: '02',
    },
    {
      icon: Sparkles,
      title: 'offerTitle',
      description: 'offerDescription',
      number: '03',
    },
  ] as const;
  return (
    <>
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1>{t('title')}</h1>
          <p className="intro-description">{t('description')}</p>
        </div>
      </section>
      <CollectionPanel />
      <section aria-labelledby="overview-heading" className="overview-section">
        <div className="section-title">
          <h2 id="overview-heading">{t('overview')}</h2>
          <p>{t('overviewDescription')}</p>
        </div>
        <div className="overview-grid">
          {cards.map((item) => (
            <Card key={item.number} className="overview-card">
              <CardContent>
                <div className="overview-card-top">
                  <span className="overview-icon">
                    <item.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="step-number">{item.number}</span>
                </div>
                <h3>{t(item.title)}</h3>
                <p>{t(item.description)}</p>
                <Badge variant="outline" className="soon-badge">
                  {common('soon')}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section
        className="opportunities-section"
        aria-labelledby="opportunities-heading"
      >
        <div className="section-title section-title-row">
          <h2 id="opportunities-heading">{t('activity')}</h2>
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </div>
        <div className="empty-opportunities">
          <div className="empty-compass" aria-hidden="true">
            <Compass size={34} strokeWidth={1.25} />
            <span />
          </div>
          <Badge variant="secondary" className="empty-badge">
            {t('emptyBadge')}
          </Badge>
          <h3>{t('emptyTitle')}</h3>
          <p>{t('emptyDescription')}</p>
        </div>
      </section>
    </>
  );
}
