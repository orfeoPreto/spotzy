/**
 * Convert euro amount to Stripe cents (integer).
 * Rounds to 2 decimal places first, then multiplies by 100.
 */
export const toStripeAmount = (euros: number): number => {
  return Math.round(Math.round(euros * 100) / 100 * 100);
};

/**
 * Calculate platform fee in cents (15%, floor to nearest cent).
 */
export const calculatePlatformFee = (totalCents: number): number => {
  return Math.floor(totalCents * 0.15);
};

/**
 * Lazy Stripe client factory — reads secret from env or Secrets Manager.
 * In tests this is mocked entirely.
 */
let _stripeSecretKey: string | undefined;

export const getStripeSecretKey = async (): Promise<string> => {
  if (_stripeSecretKey) return _stripeSecretKey;
  if (process.env.STRIPE_SECRET_KEY) {
    _stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    return _stripeSecretKey;
  }
  // Fetch from Secrets Manager at cold start
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'spotzy/stripe/secret-key' }));
  _stripeSecretKey = res.SecretString!;
  return _stripeSecretKey;
};
