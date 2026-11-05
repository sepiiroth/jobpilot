import { OfferDetail } from '@/components/offers';
import { notFound } from 'next/navigation';
import { z } from 'zod';
export const metadata = { title: 'Détail de l’offre' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <OfferDetail id={id} />;
}
