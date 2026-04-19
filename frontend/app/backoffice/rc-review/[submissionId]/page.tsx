import dynamic from 'next/dynamic';

const Client = dynamic(() => import('./BackofficeRCReviewDetailPageClient'), { ssr: false });

export function generateStaticParams() { return [{ submissionId: '_' }]; }

export default function Page() {
  return <Client />;
}
