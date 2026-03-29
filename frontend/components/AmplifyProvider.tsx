'use client';

import { Amplify } from 'aws-amplify';

Amplify.configure(
  {
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
      },
    },
  },
  { ssr: false },
);

export default function AmplifyProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
