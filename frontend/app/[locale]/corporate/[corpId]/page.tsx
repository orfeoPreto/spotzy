import CorporateClient from './CorporateClient';

export function generateStaticParams() { return [{ corpId: '_' }]; }

export default function CorporatePage() {
  return <CorporateClient />;
}
