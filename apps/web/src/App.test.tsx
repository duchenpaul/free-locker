import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function requestPath(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input.toString();
}

function appConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    fileListingMode: 'disabled',
    runtimeMode: 'local',
    maxMultipartUploadBytes: 10 * 1024 * 1024 * 1024,
    maxSingleUploadBytes: 95 * 1024 * 1024,
    retentionHours: 24,
    maxDownloads: 5,
    ...overrides,
  };
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '#/';
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (requestPath(input) === '/api/v1/config') {
          return jsonResponse(appConfig());
        }
        return jsonResponse({ success: true, mode: 'disabled', files: [] });
      }),
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds selected files to the upload queue', () => {
    render(<App />);
    const file = new File(['release notes'], 'release-notes.txt', { type: 'text/plain' });
    const input = screen.getByLabelText('Select files');

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('release-notes.txt')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send 1 file/i })).toBeEnabled();
  });

  it('renders limits from the public app configuration', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/v1/config') {
        return jsonResponse(
          appConfig({
            maxMultipartUploadBytes: 5 * 1024 * 1024 * 1024,
            retentionHours: 48,
            maxDownloads: 3,
          }),
        );
      }
      return jsonResponse({ success: true, mode: 'disabled', files: [] });
    });

    render(<App />);

    expect(
      await screen.findByText(
        /up to 5\.0 GiB each\. Uploaded items are removed after 2 days or 3 downloads, whichever comes first\./,
      ),
    ).toBeInTheDocument();
  });

  it('shows the default limits while the configuration has not loaded', () => {
    render(<App />);

    expect(screen.getByText(/up to 10 GiB each\./)).toBeInTheDocument();
    expect(screen.getByText(/removed after 1 day or 5 downloads/)).toBeInTheDocument();
  });

  it('toggles the display mode and persists the explicit choice', () => {
    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light display mode' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light display mode' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('free-locker-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark display mode' })).toBeVisible();
  });

  it('shows the Files link only when public listing is enabled', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/v1/config') {
        return jsonResponse(appConfig({ fileListingMode: 'enabled' }));
      }
      return jsonResponse({ success: true, mode: 'enabled', files: [] });
    });

    render(<App />);

    expect(await screen.findByRole('link', { name: 'Files' })).toHaveAttribute(
      'href',
      '#/file_browser',
    );
  });

  it('renders the configured public file table', async () => {
    window.location.hash = '#/file_browser';
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/v1/config') {
        return jsonResponse(appConfig({ fileListingMode: 'enabled' }));
      }
      return jsonResponse({
        success: true,
        mode: 'enabled',
        files: [
          {
            filename: 'release.zip',
            id: 'release-id',
            size: 1048576,
            uploadedAt: '2026-10-15T12:00:00.000Z',
            uploadIp: '203.0.113.14',
            downloadUrl: 'https://locker.example/share/release.zip',
            downloadCount: 2,
          },
        ],
      });
    });

    render(<App />);

    expect(await screen.findByText('release.zip')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.14')).toBeInTheDocument();
    expect(screen.getByText('1.0 MiB')).toBeInTheDocument();
    expect(screen.getByText(/1 active file.*1\.0 MiB total/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('revokes a listed file with the entered operator token', async () => {
    window.location.hash = '#/file_browser';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (requestPath(input) === '/api/v1/config') {
        return jsonResponse(appConfig({ fileListingMode: 'enabled' }));
      }
      if (requestPath(input) === '/api/v1/admin/files/release-id/revoke') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({
        success: true,
        mode: 'enabled',
        files: [
          {
            filename: 'release.zip',
            id: 'release-id',
            size: 1024,
            uploadedAt: '2026-10-15T12:00:00.000Z',
            uploadIp: '203.0.113.14',
            downloadUrl: 'https://locker.example/share/release.zip',
            downloadCount: 0,
          },
        ],
      });
    });

    render(<App />);

    await screen.findByText('release.zip');
    fireEvent.change(screen.getByLabelText('Operator token'), {
      target: { value: 'operator-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete release.zip' }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/v1/admin/files/release-id/revoke',
        expect.objectContaining({
          body: JSON.stringify({ reason: 'Removed from the file browser' }),
          headers: expect.objectContaining({ Authorization: 'Bearer operator-token' }),
          method: 'POST',
        }),
      ),
    );
  });
});
