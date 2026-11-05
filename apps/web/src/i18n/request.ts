import { getRequestConfig } from 'next-intl/server';
import messages from '../../messages/fr.json';
export default getRequestConfig(async () => ({
  locale: 'fr',
  messages,
  timeZone: 'Europe/Paris',
}));
