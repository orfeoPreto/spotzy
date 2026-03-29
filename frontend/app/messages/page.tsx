import dynamic from 'next/dynamic';

const MessagesClient = dynamic(() => import('./MessagesClient'), { ssr: false });

export default function Page() {
  return <MessagesClient />;
}
