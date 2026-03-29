import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import LoginPage from '../../../app/auth/login/page';
import RegisterPage from '../../../app/auth/register/page';
import ForgotPasswordPage from '../../../app/auth/forgot-password/page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ user: null, isLoading: false })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // JSDOM may not have localStorage in all vitest setups — stub it
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
    getItem: vi.fn((k: string) => store[k] ?? null),
    removeItem: vi.fn((k: string) => { delete store[k]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => { delete store[k]; }); }),
    length: 0,
    key: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers(); // always restore timers so fake timers don't cascade
  vi.unstubAllGlobals();
});

// ─── Login ──────────────────────────────────────────────────────────────────

describe('Auth Login', () => {
  it('renders email and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('"Sign in" button disabled when fields empty', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('shows error message on invalid credentials (401)', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'bad@test.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials|email or password/i)).toBeInTheDocument();
    });
  });

  it('successful login → redirects to dashboard', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), 'test@test.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/dashboard/));
    });
  });

  it('"Forgot password?" link renders', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
  });
});

// ─── Registration Step 1 ─────────────────────────────────────────────────────

describe('Auth Registration Step 1 — Role selection', () => {
  it('renders 3 role cards', () => {
    render(<RegisterPage />);
    const cards = document.querySelectorAll('[data-testid="role-card"]');
    expect(cards.length).toBe(3);
  });

  it('"Spot Manager" card has "Coming soon" label and is not clickable', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/spot manager/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    const spotManagerCard = document.querySelector('[data-testid="role-card"][data-role="SPOT_MANAGER"]');
    expect(spotManagerCard).toHaveAttribute('aria-disabled', 'true');
  });

  it('clicking Host card gives it amber border (selected state)', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    const hostCard = document.querySelector('[data-testid="role-card"][data-role="HOST"]') as HTMLElement;
    await user.click(hostCard);
    expect(hostCard).toHaveClass('border-[#AD3614]');
  });

  it('"Continue" button disabled until a role is selected', async () => {
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});

// ─── Registration Step 2 ─────────────────────────────────────────────────────

describe('Auth Registration Step 2 — User details', () => {
  async function goToStep2() {
    const user = userEvent.setup();
    render(<RegisterPage />);
    const hostCard = document.querySelector('[data-testid="role-card"][data-role="HOST"]') as HTMLElement;
    await user.click(hostCard);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    return user;
  }

  it('all fields render', async () => {
    await goToStep2();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it('shows "Passwords don\'t match" when passwords differ', async () => {
    const user = await goToStep2();
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Different456!');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByText(/passwords don't match|passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('shows weak password error for short passwords', async () => {
    const user = await goToStep2();
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByText(/too short|at least 8|weak password/i)).toBeInTheDocument();
    });
  });

  it('successful submit advances to Step 3', async () => {
    const user = await goToStep2();
    await user.type(screen.getByLabelText(/first name/i), 'Alice');
    await user.type(screen.getByLabelText(/last name/i), 'Host');
    await user.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /continue|next/i }));

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="otp-input"]').length).toBe(6);
    });
  });
});

// ─── Registration Step 3 — OTP ───────────────────────────────────────────────

describe('Auth Registration Step 3 — OTP', () => {
  async function goToStep3() {
    const user = userEvent.setup();
    render(<RegisterPage />);

    // Step 1: select role
    const hostCard = document.querySelector('[data-testid="role-card"][data-role="HOST"]') as HTMLElement;
    await user.click(hostCard);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: fill details
    await user.type(screen.getByLabelText(/first name/i), 'Alice');
    await user.type(screen.getByLabelText(/last name/i), 'Host');
    await user.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /continue|next/i }));

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="otp-input"]').length).toBe(6);
    });

    return user;
  }

  it('renders 6 individual OTP input boxes', async () => {
    await goToStep3();
    expect(document.querySelectorAll('[data-testid="otp-input"]').length).toBe(6);
  });

  it('entering a digit auto-focuses next box', async () => {
    const user = await goToStep3();
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-testid="otp-input"]');
    await user.type(inputs[0], '1');
    await waitFor(() => {
      expect(document.activeElement).toBe(inputs[1]);
    });
  });

  it('"Verify" button disabled until all 6 digits entered', async () => {
    const user = await goToStep3();
    expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();

    const inputs = document.querySelectorAll<HTMLInputElement>('[data-testid="otp-input"]');
    for (const input of Array.from(inputs)) {
      await user.type(input, '1');
    }
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify/i })).not.toBeDisabled();
    });
  });

  it('resend countdown starts at 60 and "Resend code" appears at 0', async () => {
    // Only fake setInterval/clearInterval so waitFor and userEvent still use real setTimeout
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const user = userEvent.setup();
    render(<RegisterPage />);

    // Step 1: select role
    const hostCard = document.querySelector('[data-testid="role-card"][data-role="HOST"]') as HTMLElement;
    await user.click(hostCard);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: fill details
    await user.type(screen.getByLabelText(/first name/i), 'Alice');
    await user.type(screen.getByLabelText(/last name/i), 'Host');
    await user.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /continue|next/i }));

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="otp-input"]').length).toBe(6);
    });

    expect(screen.getByText(/60s|60 s|resend in 60/i)).toBeInTheDocument();

    // Advance fake intervals — component's setInterval fires 60 times
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole('button', { name: /resend code/i })).toBeInTheDocument();
  });
});

// ─── Forgot Password ─────────────────────────────────────────────────────────

describe('Auth Forgot Password', () => {
  it('renders email input and submit button', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset|send|submit/i })).toBeInTheDocument();
  });

  it('shows success message after submit', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText(/email/i), 'test@test.com');
    await user.click(screen.getByRole('button', { name: /reset|send|submit/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/check your email|link sent|reset link/i).length).toBeGreaterThan(0);
    });
  });

  it('shows error for invalid email format', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordPage />);
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /reset|send|submit/i }));
    await waitFor(() => {
      expect(screen.getByText(/valid email|invalid email/i)).toBeInTheDocument();
    });
  });
});
