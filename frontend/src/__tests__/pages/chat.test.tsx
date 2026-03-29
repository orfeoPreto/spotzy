import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import ChatPage from '../../../app/chat/[bookingId]/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ bookingId: 'bk1' }),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { userId: 'u2', token: 'tok' },
    isLoading: false,
  })),
}));

const mockWsSend = vi.fn();
let mockWsInstance: {
  send: typeof mockWsSend;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  onmessage: ((e: { data: string }) => void) | null;
  onerror: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWsInstance = {
    send: mockWsSend,
    close: vi.fn(),
    readyState: 1,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  vi.stubGlobal('WebSocket', vi.fn(() => mockWsInstance));
});

afterEach(() => {
  vi.unstubAllGlobals();
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
      http.get('/api/v1/chat/bk1/messages', () =>
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

describe('Chat WebSocket', () => {
  it('new message via onmessage appears in message list', async () => {
    render(<ChatPage />);
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

    act(() => {
      if (mockWsInstance.onmessage) {
        mockWsInstance.onmessage({
          data: JSON.stringify({
            messageId: 'm-live', senderId: 'h1', contentType: 'TEXT',
            text: 'Live message!', createdAt: new Date().toISOString(),
          }),
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Live message!')).toBeInTheDocument();
    });
  });

  it('submit → ws.send called with correct payload', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/message|type here/i);
    await user.type(input, 'Hello');
    await user.keyboard('{Enter}');

    expect(mockWsSend).toHaveBeenCalledWith(
      expect.stringContaining('Hello'),
    );
  });
});

describe('Chat emoji stripping', () => {
  it('emoji removed before message is sent', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/message|type here/i);
    await user.type(input, 'Great! ');
    await user.keyboard('{Enter}');

    expect(mockWsSend).toHaveBeenCalled();
    const payload = JSON.parse(mockWsSend.mock.calls[0][0] as string);
    expect(payload.text).toMatch(/Great!/);
    expect(payload.text).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
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
    // Intercept the S3 PUT via MSW so we don't need to override global.fetch
    server.use(
      http.put('https://s3.example.com/upload', () => new HttpResponse(null, { status: 200 })),
    );
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

  it('confirm send → pre-signed URL fetched and ws.send called with imageUrl', async () => {
    const user = userEvent.setup();
    render(<ChatPage />);
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.png', { type: 'image/png' });
    await user.upload(fileInput, file);

    await waitFor(() => document.querySelector('[data-testid="image-preview"]'));

    const sendBtn = screen.getByRole('button', { name: /send/i });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(mockWsSend).toHaveBeenCalledWith(
        expect.stringContaining('imageUrl'),
      );
    });
  });
});
