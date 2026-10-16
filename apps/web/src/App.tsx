import { ArrowUpFromLine, Check, Copy, RefreshCw, Trash2, X } from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import {
  DEFAULT_MAX_DOWNLOADS,
  DEFAULT_MAX_MULTIPART_UPLOAD_BYTES,
  DEFAULT_RETENTION_HOURS,
  DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
} from '@free-locker/shared';

import {
  createUploadTask,
  fetchPublicAppConfig,
  fetchPublicFileListing,
  revokePublicFile,
  UploadRequestError,
  type UploadTask,
} from './api';

type StaticPage = 'help' | 'faq' | 'terms' | 'privacy' | 'disclaimer' | 'abuse' | 'contact';
type AppPage = 'home' | 'file_browser' | StaticPage;
type QueueStatus = 'ready' | 'uploading' | 'success' | 'failed' | 'cancelled';
type ThemePreference = 'system' | 'light' | 'dark';
type FileListingMode = 'enabled' | 'hidden' | 'disabled';

const themeStorageKey = 'free-locker-theme';

interface Limits {
  maxDownloads: number;
  maxMultipartUploadBytes: number;
  maxSingleUploadBytes: number;
  retentionHours: number;
}

const defaultLimits: Limits = {
  maxDownloads: DEFAULT_MAX_DOWNLOADS,
  maxMultipartUploadBytes: DEFAULT_MAX_MULTIPART_UPLOAD_BYTES,
  maxSingleUploadBytes: DEFAULT_SINGLE_UPLOAD_LIMIT_BYTES,
  retentionHours: DEFAULT_RETENTION_HOURS,
};

interface QueueItem {
  error?: string | undefined;
  file: File;
  id: string;
  progress: number;
  result?:
    | {
        downloadUrl: string;
        expiresAt: string;
        remainingDownloads: number;
      }
    | undefined;
  status: QueueStatus;
  uploadMode: 'direct' | 'multipart';
}

function information(limits: Limits): Record<StaticPage, { body: string[]; title: string }> {
  return {
    help: {
      title: 'Help',
      body: [
        'Choose one or more files, then send them as independent temporary transfers. Each completed transfer receives its own link.',
        'The same service accepts curl uploads. Use the command shown on the home screen, then share the returned download URL.',
        `Direct uploads are limited to ${formatBytes(limits.maxSingleUploadBytes)}. Larger files use a direct-to-R2 multipart path and need a deployment with R2 signing credentials configured.`,
      ],
    },
    faq: {
      title: 'Frequently asked questions',
      body: [
        `Transfers expire ${formatRetention(limits.retentionHours)} after activation or after ${limits.maxDownloads} distinct download authorizations, whichever arrives first.`,
        'A recipient can resume an already-authorized transfer for a short period. This helps retries and byte-range downloads but means a temporary grant may serve more than one physical request.',
        'free-locker is a transfer service, not backup storage. Keep another copy of every important file.',
      ],
    },
    terms: {
      title: 'Terms of service',
      body: [
        'You are responsible for every file you upload and must have the right to share it. Do not use the service for unlawful, harmful, or infringing material.',
        'We may revoke a transfer that violates these terms or is reported through the abuse process.',
        'The service is offered on a best-effort basis and may apply size, request, storage, or rate limits to protect its operation.',
      ],
    },
    privacy: {
      title: 'Privacy policy',
      body: [
        'The service stores file metadata needed to deliver, expire, and remove temporary transfers. Uploaded file content is kept in private object storage.',
        'For abuse prevention, operations may retain a salted, non-reversible network identifier and minimal request events for a limited period. Raw IP addresses are not retained indefinitely by the application.',
        'Do not treat a temporary transfer link as a secret with end-to-end encryption. Anyone holding a valid link may be able to access it while it is available.',
      ],
    },
    disclaimer: {
      title: 'Disclaimer',
      body: [
        'Files are removed asynchronously after expiry or download exhaustion. Access is blocked immediately by the application, but physical deletion can occur later during scheduled cleanup.',
        'The default deployment does not claim malware scanning. When a scanner is configured, files remain unavailable until it returns a result.',
        'Availability, delivery speed, and storage capacity are limited by the configured Cloudflare resources and are not guaranteed.',
      ],
    },
    abuse: {
      title: 'Report abuse',
      body: [
        'To report a transfer, include the shared link, a concise explanation, and contact information only if you want a response.',
        'Operators can revoke a reported transfer without exposing storage internals or allowing public deletion requests.',
        'A structured abuse-report endpoint is available to deployments that enable it. Until then, contact the deployment operator directly.',
      ],
    },
    contact: {
      title: 'Contact',
      body: [
        'Deployment operators should publish a contact address here before offering a public instance.',
        'Use the abuse-reporting route for urgent takedown requests rather than sending access tokens, passwords, or private data in a transfer link.',
      ],
    },
  };
}

function currentPage(): AppPage {
  const value = window.location.hash.replace(/^#\/?/, '') as AppPage;
  return Object.hasOwn(information(defaultLimits), value) ||
    value === 'home' ||
    value === 'file_browser'
    ? value
    : 'home';
}

function itemId(): string {
  // ponytail: randomUUID needs a secure context (HTTPS/localhost); fallback covers plain-HTTP LAN origins
  return (
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatRetention(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

function formatExpiration(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function statusLabel(status: QueueStatus): string {
  const labels: Record<QueueStatus, string> = {
    ready: 'Ready',
    uploading: 'Uploading',
    success: 'Stored',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

function copyToClipboard(value: string): Promise<void> {
  return navigator.clipboard === undefined
    ? Promise.reject(new Error('Clipboard access is unavailable.'))
    : navigator.clipboard.writeText(value);
}

function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function resolvedTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference !== 'system') {
    return preference;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light';
}

function ThemeControl({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}): React.JSX.Element {
  const isDark = resolvedTheme(preference) === 'dark';

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} display mode`}
      onClick={() => onChange(isDark ? 'light' : 'dark')}
    >
      <span className="tt-label">[ {isDark ? 'light' : 'dark'} ]</span>
    </button>
  );
}

function HashLink({ children, page }: { children: string; page: AppPage }): React.JSX.Element {
  return <a href={page === 'home' ? '#/' : `#/${page}`}>{children}</a>;
}

function InfoPage({ limits, page }: { limits: Limits; page: StaticPage }): React.JSX.Element {
  const content = information(limits)[page];
  return (
    <main className="info-shell">
      <section className="info-page" aria-labelledby="info-title">
        <span className="section-mark">free-locker</span>
        <h1 id="info-title">{content.title}</h1>
        {content.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <HashLink page="home">Return to transfer</HashLink>
      </section>
    </main>
  );
}

function HelpPage({ limits }: { limits: Limits }): React.JSX.Element {
  const host = window.location.origin;
  return (
    <main className="documentation" aria-labelledby="help-title">
      <h1 id="help-title">Help</h1>
      <p>Upload a file, receive a temporary link, and share it.</p>

      <section>
        <h2>Upload</h2>
        <pre>
          <code>{`curl ${host} -T ./file.zip`}</code>
        </pre>
        <p>Use the returned link to download the file while it is available.</p>
      </section>

      <section>
        <h2>Machine-readable response</h2>
        <pre>
          <code>{`curl -H 'Accept: application/json' ${host} -T ./file.zip`}</code>
        </pre>
      </section>

      <section>
        <h2>Limits</h2>
        <ul>
          <li>Direct upload: up to {formatBytes(limits.maxSingleUploadBytes)}</li>
          <li>
            Multipart upload: up to {formatBytes(limits.maxMultipartUploadBytes)} when signing is
            configured
          </li>
          <li>Retention: {formatRetention(limits.retentionHours)}</li>
          <li>Downloads: up to {limits.maxDownloads} authorizations</li>
        </ul>
      </section>
    </main>
  );
}

function FilesPage(): React.JSX.Element {
  const [error, setError] = useState<string>();
  const [files, setFiles] = useState<Awaited<ReturnType<typeof fetchPublicFileListing>>['files']>();
  const [operatorToken, setOperatorToken] = useState('');
  const [revoking, setRevoking] = useState<'all' | string>();

  const loadFiles = useEffectEvent(() => {
    setError(undefined);
    void fetchPublicFileListing()
      .then((response) => setFiles(response.files))
      .catch((reason: unknown) => {
        setFiles(undefined);
        setError(
          reason instanceof UploadRequestError
            ? reason.message
            : 'The file listing is not available.',
        );
      });
  });

  useEffect(() => {
    loadFiles();
  }, []);

  const revokeFiles = async (
    filesToRevoke: Awaited<ReturnType<typeof fetchPublicFileListing>>['files'],
    action: 'all' | string,
  ) => {
    const token = operatorToken.trim();
    if (token.length === 0) {
      setError('Enter an operator token before deleting files.');
      return;
    }

    const description = filesToRevoke.length === 1 ? 'this file' : `${filesToRevoke.length} files`;
    if (!window.confirm(`Delete ${description}? Downloads will stop immediately.`)) {
      return;
    }

    setError(undefined);
    setRevoking(action);
    try {
      await Promise.all(filesToRevoke.map((file) => revokePublicFile(file.id, token)));
      loadFiles();
    } catch (reason) {
      setError(
        reason instanceof UploadRequestError ? reason.message : 'Unable to delete the files.',
      );
    } finally {
      setRevoking(undefined);
    }
  };

  const totalSize = files?.reduce((total, file) => total + file.size, 0) ?? 0;

  return (
    <main className="files-page" aria-labelledby="files-title">
      <section className="files-page__header">
        <div>
          <span className="section-mark">Temporary transfer index</span>
          <h1 id="files-title">Available files</h1>
          <p>
            {files === undefined
              ? 'Only active shares that have not expired or exhausted their allowance appear here.'
              : `${files.length} active file${files.length === 1 ? '' : 's'} · ${formatBytes(totalSize)} total`}
          </p>
        </div>
        <div className="file-browser-actions">
          <label>
            <span>Operator token</span>
            <input
              type="password"
              autoComplete="off"
              value={operatorToken}
              onChange={(event) => setOperatorToken(event.target.value)}
            />
          </label>
          <button
            className="icon-button icon-button--danger"
            type="button"
            onClick={() => void revokeFiles(files ?? [], 'all')}
            disabled={files === undefined || files.length === 0 || revoking !== undefined}
            aria-label="Delete all listed files"
            title="Delete all listed files"
          >
            <Trash2 size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={loadFiles}
            disabled={revoking !== undefined}
            aria-label="Refresh files"
            title="Refresh files"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </section>
      {error !== undefined ? <p className="files-page__error">{error}</p> : null}
      {files === undefined && error === undefined ? (
        <p className="files-page__loading">Loading files...</p>
      ) : null}
      {files !== undefined && files.length === 0 ? (
        <p className="files-page__loading">No active files are available.</p>
      ) : null}
      {files !== undefined && files.length > 0 ? (
        <div className="files-table-wrap">
          <table className="files-table">
            <thead>
              <tr>
                <th scope="col">File name</th>
                <th scope="col">Size</th>
                <th scope="col">Uploaded date</th>
                <th scope="col">Upload IP</th>
                <th scope="col">Download link</th>
                <th scope="col">Download times</th>
                <th scope="col">Delete</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.downloadUrl}>
                  <td data-label="File name">{file.filename}</td>
                  <td data-label="Size">{formatBytes(file.size)}</td>
                  <td data-label="Uploaded date">{formatExpiration(file.uploadedAt)}</td>
                  <td data-label="Upload IP">{file.uploadIp ?? 'Not recorded'}</td>
                  <td data-label="Download link">
                    <a href={file.downloadUrl}>Download</a>
                  </td>
                  <td data-label="Download times">{file.downloadCount}</td>
                  <td data-label="Delete">
                    <button
                      className="icon-button icon-button--danger"
                      type="button"
                      onClick={() => void revokeFiles([file], file.id)}
                      disabled={revoking !== undefined}
                      aria-label={`Delete ${file.filename}`}
                      title={`Delete ${file.filename}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

function UploadQueueItem({
  item,
  onCancel,
  onCopy,
  onRemove,
  onRetry,
}: {
  item: QueueItem;
  onCancel: () => void;
  onCopy: (value: string) => void;
  onRemove: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  const canRetry = item.status === 'failed' || item.status === 'cancelled';
  return (
    <li className={`queue-item queue-item--${item.status}`}>
      <div className="queue-item__body">
        <div className="queue-item__title-row">
          <strong title={item.file.name}>{item.file.name}</strong>
          <span className="status-label">{statusLabel(item.status)}</span>
          <span className="queue-item__meta">{formatBytes(item.file.size)}</span>
        </div>
        {item.uploadMode === 'multipart' ? <div className="queue-item__meta">Multipart</div> : null}
        {item.status === 'uploading' ? (
          <div className="up-bar" aria-label={`${item.file.name} upload progress`}>
            <div
              className="up-bar-fill"
              role="progressbar"
              aria-label={`${item.file.name} upload progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.progress}
              style={{ width: `${item.progress}%` }}
            />
          </div>
        ) : null}
        {item.error !== undefined ? <p className="queue-item__error">{item.error}</p> : null}
        {item.result !== undefined ? (
          <div className="share-result">
            <a href={item.result.downloadUrl}>{item.result.downloadUrl}</a>
            <button
              className="icon-button"
              type="button"
              onClick={() => onCopy(item.result?.downloadUrl ?? '')}
              aria-label={`Copy ${item.file.name} download link`}
              title="Copy download link"
            >
              <Copy size={16} />
            </button>
            <span className="share-result__expiry">
              {item.result.remainingDownloads} downloads left · available until{' '}
              {formatExpiration(item.result.expiresAt)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="queue-item__tools">
        {item.status === 'uploading' ? (
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            aria-label={`Cancel ${item.file.name} upload`}
            title="Cancel upload"
          >
            <X size={17} />
          </button>
        ) : null}
        {canRetry ? (
          <button
            className="icon-button"
            type="button"
            onClick={onRetry}
            aria-label={`Retry ${item.file.name} upload`}
            title="Retry upload"
          >
            <RefreshCw size={17} />
          </button>
        ) : null}
        {item.status !== 'uploading' ? (
          <button
            className="icon-button"
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.file.name}`}
            title="Remove file"
          >
            <Trash2 size={17} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function HomePage({ limits }: { limits: Limits }): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null);
  const activeUploads = useRef(new Map<string, UploadTask>());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [browserHeader, setBrowserHeader] = useState('');

  useEffect(
    () => () => {
      for (const task of activeUploads.current.values()) {
        task.abort();
      }
    },
    [],
  );

  useEffect(() => {
    // sendit-style full-page drag & drop: any dragover arms the overlay.
    const onDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault();
      setIsDragging(true);
    };
    document.body.addEventListener('dragover', onDragOver);
    return () => document.body.removeEventListener('dragover', onDragOver);
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const nextItems: QueueItem[] = Array.from(files).map((file) => ({
      file,
      id: itemId(),
      progress: 0,
      status: 'ready',
      uploadMode: file.size > limits.maxSingleUploadBytes ? 'multipart' : 'direct',
    }));
    setItems((currentItems) => [...currentItems, ...nextItems]);
  };

  const updateItem = (id: string, update: (item: QueueItem) => QueueItem) => {
    setItems((currentItems) => currentItems.map((item) => (item.id === id ? update(item) : item)));
  };

  const uploadItem = async (item: QueueItem) => {
    updateItem(item.id, (current) => ({
      ...current,
      error: undefined,
      progress: 0,
      result: undefined,
      status: 'uploading',
    }));
    const task = createUploadTask(item.file, limits.maxSingleUploadBytes, (progress) => {
      updateItem(item.id, (current) =>
        current.status === 'uploading' ? { ...current, progress } : current,
      );
    });
    activeUploads.current.set(item.id, task);

    try {
      const result = await task.promise;
      updateItem(item.id, (current) => ({
        ...current,
        progress: 100,
        result: {
          downloadUrl: result.downloadUrl,
          expiresAt: result.expiresAt,
          remainingDownloads: result.remainingDownloads,
        },
        status: 'success',
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        updateItem(item.id, (current) => ({ ...current, status: 'cancelled' }));
      } else {
        const message =
          error instanceof UploadRequestError
            ? error.message
            : 'The upload did not complete. Please retry it.';
        updateItem(item.id, (current) => ({ ...current, error: message, status: 'failed' }));
      }
    } finally {
      activeUploads.current.delete(item.id);
    }
  };

  const uploadReadyFiles = () => {
    const readyItems = items.filter(
      (item) => item.status === 'ready' || item.status === 'failed' || item.status === 'cancelled',
    );
    void Promise.all(readyItems.map((item) => uploadItem(item)));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const copy = (value: string) => {
    void copyToClipboard(value)
      .then(() => setNotice('Copied to clipboard.'))
      .catch(() =>
        setNotice('Clipboard access was unavailable. Select the link and copy it manually.'),
      );
  };

  const readyCount = items.filter(
    (item) => item.status === 'ready' || item.status === 'failed' || item.status === 'cancelled',
  ).length;
  const host = window.location.origin;
  const curlCommand = `curl ${host}/ -T ./file.zip`;

  return (
    <main>
      <div id="focus">
        <div
          id="upload-instructions"
          onClick={() => copy(curlCommand)}
          onMouseOver={() => setBrowserHeader('Click to copy')}
          onMouseOut={() => setBrowserHeader('')}
          onFocus={() => setBrowserHeader('Click to copy')}
          onBlur={() => setBrowserHeader('')}
        >
          <div id="browser-header">{browserHeader}</div>
          <code>{curlCommand}</code>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          style={{ display: 'none' }}
          aria-label="Select files"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (event.target.files !== null) {
              addFiles(event.target.files);
            }
            event.target.value = '';
          }}
        />

        {items.length > 0 ? (
          <>
            <div className="queue-heading">
              <h2>{`${items.length} file${items.length === 1 ? '' : 's'} staged`}</h2>
              {readyCount > 0 ? (
                <button className="button" type="button" onClick={uploadReadyFiles}>
                  <ArrowUpFromLine size={17} />
                  Send {readyCount} file{readyCount === 1 ? '' : 's'}
                </button>
              ) : null}
            </div>
            <ul id="uploaded">
              {items.map((item) => (
                <UploadQueueItem
                  key={item.id}
                  item={item}
                  onCancel={() => activeUploads.current.get(item.id)?.abort()}
                  onCopy={copy}
                  onRemove={() =>
                    setItems((current) => current.filter((entry) => entry.id !== item.id))
                  }
                  onRetry={() => void uploadItem(item)}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div
        id="dropper"
        className={isDragging ? 'active' : ''}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInput.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to choose files"
      >
        Drop your files here...
      </div>
      <div
        id="dropzone"
        className={isDragging ? 'active' : ''}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      />

      <hr />

      <section id="seo-content" style={{ textAlign: 'left' }}>
        <h2 style={{ marginTop: 25, fontSize: 22 }}>
          Fast &amp; Simple Bash Upload Tool for Developers
        </h2>

        <p>
          Upload files instantly from the command line using <strong>curl</strong>,{' '}
          <strong>wget</strong>, or any shell script. This lightweight tool is built for developers,
          sysadmins, and DevOps engineers who need a fast, distraction-free{' '}
          <strong>CLI upload</strong> solution that &ldquo;just works&rdquo;.
        </p>

        <p>
          Whether you&apos;re sharing logs, moving build artifacts, or transferring files between
          servers, this service provides a clean and efficient way to send files from the terminal
          and download them from any device.
        </p>

        <h3 style={{ marginTop: 25 }}>transfer.sh-style uploads</h3>
        <p>
          The classic upload flag is supported unchanged &mdash; point your scripts at this host and
          go:
        </p>
        <pre>curl --upload-file ./file.zip {host}</pre>
        <p>
          Same one-command workflow, no account, an open link back. Files are kept for{' '}
          {formatRetention(limits.retentionHours)} or {limits.maxDownloads} downloads, whichever
          comes first.
        </p>

        <h3>Why Use This CLI Upload Service?</h3>
        <ul style={{ marginLeft: 20 }}>
          <li>
            One-command <strong>bash upload</strong>
          </li>
          <li>
            Fast <strong>command-line file uploads</strong> without setup or auth
          </li>
          <li>Works on Linux, macOS, Windows (Git Bash / WSL)</li>
          <li>Ideal for servers, SSH-only systems, CI/CD pipelines, and automation scripts</li>
          <li>Browser users can upload files easily without installing anything</li>
        </ul>

        <p>The workflow is extremely simple:</p>

        <pre>curl {host} -T your_file.txt</pre>

        <h3 style={{ marginTop: 25 }}>Use it in your CI/CD pipeline</h3>
        <p>Publish a build artifact and print its link straight from a job. GitHub Actions:</p>
        <pre>{`# .github/workflows/share.yml
- name: Share build artifact
  run: curl -sf ${host} -T ./dist/app.tar.gz | grep -o 'https\\?://[^ ]*'`}</pre>
        <p>GitLab CI:</p>
        <pre>{`share:
  script:
    - curl -sf ${host} -T ./dist/app.tar.gz | grep -o 'https\\?://[^ ]*'`}</pre>
        <p className="note">
          Need machine-readable output? Add <strong>-H &quot;Accept: application/json&quot;</strong>{' '}
          to get a JSON reply you can parse.
        </p>
      </section>

      {notice !== undefined ? (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            className="icon-button"
            type="button"
            onClick={() => setNotice(undefined)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

export function App(): React.JSX.Element {
  const [page, setPage] = useState<AppPage>(currentPage);
  const [fileListingMode, setFileListingMode] = useState<FileListingMode>('disabled');
  const [limits, setLimits] = useState<Limits>(defaultLimits);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    const onHashChange = () => setPage(currentPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    void fetchPublicAppConfig()
      .then((config) => {
        setFileListingMode(config.fileListingMode);
        setLimits({
          maxDownloads: config.maxDownloads,
          maxMultipartUploadBytes: config.maxMultipartUploadBytes,
          maxSingleUploadBytes: config.maxSingleUploadBytes,
          retentionHours: config.retentionHours,
        });
      })
      .catch(() => setFileListingMode('disabled'));
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    const updateDocumentTheme = () => {
      document.documentElement.dataset.theme = resolvedTheme(themePreference);
    };
    updateDocumentTheme();

    if (themePreference !== 'system' || mediaQuery === undefined) {
      return;
    }

    mediaQuery.addEventListener('change', updateDocumentTheme);
    return () => mediaQuery.removeEventListener('change', updateDocumentTheme);
  }, [themePreference]);

  const changeTheme = (preference: ThemePreference) => {
    setThemePreference(preference);
    try {
      window.localStorage.setItem(themeStorageKey, preference);
    } catch {
      // The appearance can still change when persistent storage is unavailable.
    }
  };

  return (
    <div id="content">
      <header>
        <div className="header-actions">
          <nav aria-label="Primary navigation">
            {page !== 'home' ? (
              <>
                <HashLink page="home">Home</HashLink>
                {' \u00b7 '}
              </>
            ) : null}
            {fileListingMode === 'enabled' ? (
              <>
                <HashLink page="file_browser">Files</HashLink>
                {' \u00b7 '}
              </>
            ) : null}
            <HashLink page="help">Help</HashLink>
          </nav>
          <ThemeControl preference={themePreference} onChange={changeTheme} />
        </div>
        <h1>free-locker | Bash Upload</h1>
        <p>
          Transfer files straight from your terminal for quick sharing between servers, desktops, or
          mobile devices, up to {formatBytes(limits.maxMultipartUploadBytes)} each. Uploaded items
          are removed after {formatRetention(limits.retentionHours)} or {limits.maxDownloads}{' '}
          downloads, whichever comes first.
        </p>
      </header>

      {page === 'home' ? (
        <HomePage limits={limits} />
      ) : page === 'file_browser' ? (
        <FilesPage />
      ) : page === 'help' ? (
        <HelpPage limits={limits} />
      ) : (
        <InfoPage limits={limits} page={page} />
      )}

      <footer>
        <HashLink page="disclaimer">terms &amp; conditions</HashLink>
        <br />
        <HashLink page="contact">contact</HashLink>
        <br />
        <a
          href="https://github.com/duchenpaul/free-locker"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="currentColor"
            aria-hidden="true"
            style={{ verticalAlign: '-2px' }}
          >
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>{' '}
          GitHub
        </a>
      </footer>
    </div>
  );
}
