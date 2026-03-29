import dynamic from 'next/dynamic';

const PhotosClient = dynamic(() => import('./PhotosClient'), { ssr: false });

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function PhotosPage() {
  return <PhotosClient />;
}
