import dynamic from 'next/dynamic';
import { SUPPORTED_LOCALES } from '../../lib/locales/constants';
import LocaleLayoutClient from './LocaleLayoutClient';

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  return <LocaleLayoutClient params={params}>{children}</LocaleLayoutClient>;
}
