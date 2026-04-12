import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import DisputePage from '../../../app/[locale]/dispute/[bookingId]/DisputeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ bookingId: 'bk1' }),
  usePathname: () => '/dispute/bk1',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'u2', token: 'tok' },
    isLoading: false,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Mock the dispute GET endpoint to return no existing dispute
  server.use(
    http.get('*/api/v1/disputes', () => HttpResponse.json({})),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Dispute page rendering', () => {
  it('shows "Spotzy Support" header', async () => {
    render(<DisputePage />);
    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: /spotzy support/i });
      expect(heading).toBeInTheDocument();
    });
  });

  it('has navy-tinted background styling', async () => {
    render(<DisputePage />);
    await waitFor(() => {
      const main = document.querySelector('main, [data-testid="dispute-page"]');
      expect(main?.className).toMatch(/navy|blue|1A3C5E|\[#004526\]/i);
    });
  });

  it('initial AI message auto-rendered after loading', async () => {
    render(<DisputePage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-message-initial')).toBeInTheDocument();
    });
  });
});

describe('Dispute quick reply chips', () => {
  it('4 chips render below initial AI message', async () => {
    render(<DisputePage />);
    await waitFor(() => {
      const chips = document.querySelectorAll('[data-testid="quick-reply-chip"]');
      expect(chips.length).toBe(4);
    });
  });

  it('clicking a chip sends that category as a message', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);
    const chips = document.querySelectorAll('[data-testid="quick-reply-chip"]');
    await user.click(chips[0] as HTMLElement);
    // Chips call sendMessage directly, so the message should appear in the chat
    await waitFor(() => {
      expect(screen.getByText('Damage to my vehicle')).toBeInTheDocument();
    });
  });

  it('chips disappear after first message is sent', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'There is a problem with my booking');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="quick-reply-chip"]').length).toBe(0);
    });
  });
});

describe('Dispute photo upload', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/v1/disputes', () =>
        HttpResponse.json({ disputeId: 'd1', referenceNumber: 'DIS-001' }, { status: 201 }),
      ),
      http.get('*/api/v1/disputes', () =>
        HttpResponse.json({
          disputeId: 'd1',
          referenceNumber: 'DIS-001',
          messages: [
            { messageId: 'u-1', role: 'USER', text: 'There is damage', contentType: 'TEXT' },
            { messageId: 'ai-confirm', role: 'AI', text: 'Your dispute has been created (ref: DIS-001).', contentType: 'TEXT' },
            { messageId: 'ai-evidence', role: 'AI', text: 'Can you please upload photos as evidence?', contentType: 'TEXT', requestsEvidence: true },
          ],
        }),
      ),
    );
    class MockFileReader {
      result = 'data:image/png;base64,abc';
      onload: ((e: { target: { result: string } }) => void) | null = null;
      readAsDataURL(_: File) { if (this.onload) this.onload({ target: { result: this.result } }); }
    }
    vi.stubGlobal('FileReader', MockFileReader);
  });

  it('"Add photos" button appears after AI requests evidence', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'There is damage');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add photos/i })).toBeInTheDocument();
    });
  });

  it('selecting photos shows inline thumbnail preview', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'There is damage');
    await user.keyboard('{Enter}');

    await waitFor(() => screen.getByRole('button', { name: /add photos/i }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'evidence.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="evidence-thumbnail"]')).toBeInTheDocument();
    });
  });
});

describe('Dispute message flow', () => {
  it('first message creates dispute via POST /api/v1/disputes', async () => {
    let disputePosted = false;
    server.use(
      http.post('/api/v1/disputes', () => {
        disputePosted = true;
        return HttpResponse.json({ disputeId: 'd1', referenceNumber: 'DIS-001' }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'There is damage to my car');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(disputePosted).toBe(true));
  });

  it('after creating dispute, AI confirmation message appears with reference', async () => {
    server.use(
      http.post('/api/v1/disputes', () =>
        HttpResponse.json({ disputeId: 'd1', referenceNumber: 'DIS-001' }, { status: 201 }),
      ),
      http.get('*/api/v1/disputes', () =>
        HttpResponse.json({
          disputeId: 'd1',
          referenceNumber: 'DIS-001',
          messages: [
            { messageId: 'u-1', role: 'USER', text: 'There is damage', contentType: 'TEXT' },
            { messageId: 'ai-confirm', role: 'AI', text: 'Your dispute has been created (ref: DIS-001). We will review it shortly.', contentType: 'TEXT' },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'There is damage');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/DIS-001/)).toBeInTheDocument();
    });
  });
});

describe('Dispute evidence upload', () => {
  it('sends message and enables evidence upload', async () => {
    server.use(
      http.post('/api/v1/disputes', () =>
        HttpResponse.json({ disputeId: 'd1', referenceNumber: 'DIS-001' }, { status: 201 }),
      ),
      http.get('*/api/v1/disputes', () =>
        HttpResponse.json({
          disputeId: 'd1',
          referenceNumber: 'DIS-001',
          messages: [
            { messageId: 'u-1', role: 'USER', text: 'There is damage', contentType: 'TEXT' },
            { messageId: 'ai-confirm', role: 'AI', text: 'Your dispute has been created (ref: DIS-001).', contentType: 'TEXT' },
            { messageId: 'ai-evidence', role: 'AI', text: 'Can you please upload photos as evidence?', contentType: 'TEXT', requestsEvidence: true },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'There is damage');
    await user.keyboard('{Enter}');

    // After first message, AI response with requestsEvidence enables upload
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add photos/i })).toBeInTheDocument();
    });
  });
});
