import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import ChatPage from '../../../app/[locale]/chat/[bookingId]/ChatClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ bookingId: 'bk1' }),
  usePathname: () => '/en/chat/bk1',
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
});

describe('Chat page rendering', () => {
  it('shows booking context banner with address and reference', async () => {
    render(<ChatPage />);
    await waitFor(() => {
      expect(screen.getByText(/Rue Neuve 1, Brussels/)).toBeInTheDocument();
      expect(screen.getByText(/REF-AB12/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no messages', async () => {
    render(<ChatPage />);
    await waitFor(() => {
      expect(screen.getByText(/no messages yet|start the conversation/i)).toBeInTheDocument();
    });
  });
});

describe('Chat message bubbles', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/chat/bk1', () =>
        HttpResponse.json({
          messages: [
            { messageId: 'm1', senderId: 'u2', contentType: 'TEXT', text: 'Hello there', createdAt: '2025-07-10T10:00:00Z' },
            { messageId: 'm2', senderId: 'h1', contentType: 'TEXT', text: 'Hi, welcome!', createdAt: '2025-07-10T10:01:00Z' },
            { messageId: 'm3', senderId: 'h1', contentType: 'IMAGE', imageUrl: 'https://example.com/img.jpg', createdAt: '2025-07-10T10:02:00Z' },
          ],
        }),
      ),
    );
  });

  it('own messages right-aligned with navy background', async () => {
    render(<ChatPage />);
    await waitFor(() => {
      const bubble = document.querySelector('[data-testid="chat-bubble"][data-own="true"]');
      expect(bubble).toBeInTheDocument();
      expect(bubble).toHaveClass('bg-[#004526]');
    });
  });

  it('other party messages left-aligned with mist background', async () => {
    render(<ChatPage />);
    await waitFor(() => {
      const bubbles = document.querySelectorAll('[data-testid="chat-bubble"][data-own="false"]');
      expect(bubbles.length).toBeGreaterThan(0);
      expect(bubbles[0]).not.toHaveClass('bg-[#004526]');
    });
  });

  it('timestamps shown on messages', async () => {
    render(<ChatPage />);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="message-time"]').length).toBeGreaterThan(0);
    });
  });

  it('IMAGE message renders thumbnail not raw URL', async () => {
    render(<ChatPage />);
    await waitFor(() => {
      const img = document.querySelector('img[src="https://example.com/img.jpg"]');
      expect(img).toBeInTheDocument();
      expect(screen.queryByText('https://example.com/img.jpg')).not.toBeInTheDocument();
    });
  });
});

describe('Chat sending messages', () => {
  beforeEach(() => {
    // Default: return empty messages, then return the sent one on poll
    let messagesSent = false;
    server.use(
      http.get('/api/v1/chat/bk1', () => {
        if (messagesSent) {
          return HttpResponse.json({
            messages: [
              { messageId: 'm-sent', senderId: 'u2', contentType: 'TEXT', text: 'Hello', createdAt: new Date().toISOString() },
            ],
          });
        }
        return HttpResponse.json({ messages: [] });
      }),
      http.post('/api/v1/chat/bk1', async ({ request }) => {
        messagesSent = true;
        const body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          messageId: 'm-sent',
          senderId: 'u2',
          contentType: body.type ?? 'TEXT',
          text: body.content as string,
          createdAt: new Date().toISOString(),
        });
      }),
    );
  });

  it('submit sends message via REST', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);

    const input = screen.getByPlaceholderText(/message|type here/i);
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');

    // Optimistic update should show the message immediately
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });

  it('new message appears in message list after send', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);

    const input = screen.getByPlaceholderText(/message|type here/i);
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });
});

describe('Chat emoji stripping', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/chat/bk1', () => HttpResponse.json({ messages: [] })),
      http.post('/api/v1/chat/bk1', () => HttpResponse.json({ ok: true })),
    );
  });

  it('emoji removed before message is sent', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);

    const input = screen.getByPlaceholderText(/message|type here/i);
    await user.type(input, 'Great! ');
    await user.keyboard('{Enter}');

    // Optimistic message should have emoji stripped
    await waitFor(() => {
      const msgs = document.querySelectorAll('[data-testid="chat-bubble"]');
      expect(msgs.length).toBeGreaterThan(0);
    });
    // The text should be "Great!" without emoji
    expect(screen.getByText('Great!')).toBeInTheDocument();
  });
});

describe('Chat image upload', () => {
  beforeEach(() => {
    class MockFileReader {
      result = 'data:image/png;base64,abc';
      onload: ((e: { target: { result: string } }) => void) | null = null;
      readAsDataURL(_: File) { if (this.onload) this.onload({ target: { result: this.result } }); }
    }
    vi.stubGlobal('FileReader', MockFileReader);
    server.use(
      http.get('/api/v1/chat/bk1', () => HttpResponse.json({ messages: [] })),
      http.put('https://s3.example.com/upload', () => new HttpResponse(null, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('file selected → thumbnail preview in input area', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="image-preview"]')).toBeInTheDocument();
    });
  });

  it('confirm send → sends image via REST', async () => {
    let postCalled = false;
    server.use(
      http.post('/api/v1/chat/bk1/upload-url', () =>
        HttpResponse.json({
          uploadUrl: 'https://s3.example.com/upload',
          imageUrl: 'https://s3.example.com/photo.jpg',
        }),
      ),
      http.post('/api/v1/chat/bk1', async () => {
        postCalled = true;
        return HttpResponse.json({ ok: true });
      }),
    );

    const user = userEvent.setup();
    render(<ChatPage />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => document.querySelector('[data-testid="image-preview"]'));

    const sendBtn = screen.getByRole('button', { name: /send/i });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(postCalled).toBe(true);
    });
  });
});
