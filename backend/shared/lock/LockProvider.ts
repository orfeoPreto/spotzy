export interface LockProvider {
  generateCode(params: {
    lockId: string;
    validFrom: Date;
    validUntil: Date;
    bookingId: string;
  }): Promise<{ code: string; codeId: string }>;

  revokeCode(params: {
    lockId: string;
    codeId: string;
  }): Promise<void>;

  getDevices(params: {
    apiKey: string;
  }): Promise<Array<{ deviceId: string; name: string; type: string }>>;
}

export function getLockProvider(provider: string): LockProvider {
  switch (provider) {
    case 'SEAM':
      // Dynamic import to avoid bundling unused provider
      const { SeamProvider } = require('./SeamProvider');
      return new SeamProvider();
    default:
      throw new Error(`Lock provider ${provider} not supported`);
  }
}
