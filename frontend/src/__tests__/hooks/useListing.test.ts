import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { useListing } from '../../../hooks/useListing';

describe('useListing', () => {
  it('returns isLoading: true on initial render', () => {
    const { result } = renderHook(() => useListing('l1'));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.listing).toBeUndefined();
  });

  it('returns listing data after fetch resolves', async () => {
    const { result } = renderHook(() => useListing('l1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.listing).toBeDefined();
    expect(result.current.listing?.listingId).toBe('l1');
    expect(result.current.error).toBeUndefined();
  });

  it('returns error on fetch failure', async () => {
    server.use(
      http.get('/api/v1/listings/:id', () =>
        HttpResponse.json({ error: 'Not found' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useListing('not-found'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeDefined();
    expect(result.current.listing).toBeUndefined();
  });
});
