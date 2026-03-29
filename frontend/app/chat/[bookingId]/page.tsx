import dynamic from 'next/dynamic';

const ChatClient = dynamic(() => import('./ChatClient'), { ssr: false });

export function generateStaticParams() {
  return [{ bookingId: '_' }];
}

export default function Page() {
  return <ChatClient />;
}
