import { LockProvider } from './LockProvider';

const SEAM_API_KEY = process.env.SEAM_API_KEY ?? '';
const SEAM_BASE_URL = 'https://connect.getseam.com';

function generateNumericCode(length: number): string {
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

export class SeamProvider implements LockProvider {
  async generateCode({ lockId, validFrom, validUntil, bookingId }: {
    lockId: string; validFrom: Date; validUntil: Date; bookingId: string;
  }) {
    const code = generateNumericCode(6);
    const res = await fetch(`${SEAM_BASE_URL}/access_codes/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SEAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: lockId,
        name: `Spotzy-${bookingId}`,
        code,
        starts_at: validFrom.toISOString(),
        ends_at: validUntil.toISOString(),
      }),
    });
    const data = await res.json() as { access_code: { access_code_id: string; code: string } };
    return { code: data.access_code.code ?? code, codeId: data.access_code.access_code_id };
  }

  async revokeCode({ codeId }: { lockId: string; codeId: string }) {
    await fetch(`${SEAM_BASE_URL}/access_codes/delete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SEAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code_id: codeId }),
    });
  }

  async getDevices({ apiKey }: { apiKey: string }) {
    const res = await fetch(`${SEAM_BASE_URL}/devices/list`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json() as { devices: Array<{ device_id: string; device_type: string; properties: { name: string } }> };
    return (data.devices ?? []).map(d => ({
      deviceId: d.device_id,
      name: d.properties.name,
      type: d.device_type,
    }));
  }
}
