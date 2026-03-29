import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import DisputePage from '../../../app/dispute/[bookingId]/DisputeClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ bookingId: 'bk1' }),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'u2', token: 'tok' },
    isLoading: false,
  })),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('Dispute page rendering', () => {
  it('shows "Spotzy Support" header with shield icon', () => {
    render(<DisputePage />);
    const heading = screen.getByRole('heading', { name: /spotzy support/i });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toMatch(/🛡/);
  });

  it('has navy-tinted background styling', () => {
    render(<DisputePage />);
    const main = document.querySelector('main, [data-testid="dispute-page"]');
    expect(main?.className).toMatch(/navy|blue|1A3C5E|\[#004526\]/i);
  });

  it('initial AI message auto-rendered on page load', () => {
    render(<DisputePage />);
    expect(screen.getByTestId('ai-message-initial')).toBeInTheDocument();
  });
});

describe('Dispute quick reply chips', () => {
  it('4 chips render below initial AI message', () => {
    render(<DisputePage />);
    const chips = document.querySelectorAll('[data-testid="quick-reply-chip"]');
    expect(chips.length).toBe(4);
  });

  it('clicking a chip pre-fills text input with that category', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);
    const chips = document.querySelectorAll('[data-testid="quick-reply-chip"]');
    await user.click(chips[0] as HTMLElement);
    const input = screen.getByRole('textbox');
    expect((input as HTMLInputElement).value).toBeTruthy();
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
      http.post('/api/v1/disputes/message', () =>
        HttpResponse.json({
          messageId: 'ai-2',
          contentType: 'TEXT',
          text: 'Can you please upload photos as evidence?',
          requestsEvidence: true,
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

describe('Dispute summary card', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/v1/disputes/message', () =>
        HttpResponse.json({
          messageId: 'ai-summary',
          contentType: 'SUMMARY',
          summary: { category: 'Damage', description: 'Scratched bumper', photoCount: 2 },
        }),
      ),
    );
  });

  it('AI SUMMARY card shows category, description, photo count and confirm button', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'ready for summary');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('dispute-summary-card')).toBeInTheDocument();
      expect(screen.getByText(/Damage/)).toBeInTheDocument();
      expect(screen.getByText(/Scratched bumper/)).toBeInTheDocument();
      expect(screen.getByText(/2 photo/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm and submit/i })).toBeInTheDocument();
    });
  });

  it('"Confirm and submit" → POST /api/v1/disputes called', async () => {
    let disputePosted = false;
    server.use(
      http.post('/api/v1/disputes', () => {
        disputePosted = true;
        return HttpResponse.json({ disputeId: 'd1', reference: 'DIS-001' }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'ready for summary');
    await user.keyboard('{Enter}');

    await waitFor(() => screen.getByRole('button', { name: /confirm and submit/i }));
    await user.click(screen.getByRole('button', { name: /confirm and submit/i }));

    await waitFor(() => expect(disputePosted).toBe(true));
  });
});

describe('Dispute escalation', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/v1/disputes/message', () =>
        HttpResponse.json({
          messageId: 'ai-esc',
          contentType: 'ESCALATED',
          reference: 'ESC-001',
        }),
      ),
    );
  });

  it('ESCALATED response shows "Transferring to agent" spinner', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'escalate this');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/transferring to agent/i)).toBeInTheDocument();
    });
  });

  it('then shows "Agent connected" and reference in monospace badge', async () => {
    const user = userEvent.setup();
    render(<DisputePage />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'escalate this');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/agent connected/i)).toBeInTheDocument();
      const badge = screen.getByTestId('escalation-reference');
      expect(badge).toHaveClass('font-mono');
      expect(badge).toHaveTextContent('ESC-001');
    }, { timeout: 3000 });
  });
});
