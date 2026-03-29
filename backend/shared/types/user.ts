export interface User {
  userId: string;
  email: string;
  name: string;
  phone?: string;
  avatarUrl?: string;
  role: 'host' | 'spotter' | 'both';
  stripeCustomerId?: string;
  stripeAccountId?: string;
  createdAt: string;
  updatedAt: string;
}
