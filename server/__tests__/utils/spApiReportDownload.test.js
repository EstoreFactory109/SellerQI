/**
 * Tests for the hardened SP-API report download.
 *
 * These cover the two failure modes the previous implementation handled WRONGLY rather than
 * merely slowly:
 *   - a stall used to hang until the OS gave up (~2h), consuming the whole BullMQ job lock
 *   - a cleanly-closed-but-short body used to RESOLVE with partial data, which the finance
 *     sync would then persist as a settled $0 for real revenue days
 *
 * Driven against a real loopback HTTP server so the socket/stream behaviour is genuine rather
 * than a mock's approximation of it.
 */

const http = require('http');
const zlib = require('zlib');
const {
  downloadReportContent,
  countNonEmptyLines,
  isUnusableReportPayload,
  HEADER_ONLY_MAX_BYTES,
} = require('../../utils/spApiReportDownload.js');

let server;
let baseUrl;
let handler;

beforeAll((done) => {
  server = http.createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  handler = (req, res) => res.end('');
  delete process.env.SPAPI_REPORT_DOWNLOAD_TIMEOUT_MS;
  delete process.env.SPAPI_REPORT_IDLE_TIMEOUT_MS;
  delete process.env.SPAPI_REPORT_MAX_BYTES;
});

const TSV = 'a\tb\n1\t2\n3\t4\n';

describe('happy path', () => {
  test('returns the body plus byte counts and duration', async () => {
    handler = (req, res) => {
      res.setHeader('content-length', Buffer.byteLength(TSV));
      res.end(TSV);
    };

    const result = await downloadReportContent(`${baseUrl}/r`);

    expect(result.text).toBe(TSV);
    expect(result.compressedBytes).toBe(Buffer.byteLength(TSV));
    expect(result.decompressedBytes).toBe(Buffer.byteLength(TSV));
    expect(typeof result.durationMs).toBe('number');
  });

  test('gunzips when isGzip is set, and reports both sizes', async () => {
    const gz = zlib.gzipSync(Buffer.from(TSV));
    handler = (req, res) => {
      res.setHeader('content-length', gz.length);
      res.end(gz);
    };

    const result = await downloadReportContent(`${baseUrl}/r`, { isGzip: true });

    expect(result.text).toBe(TSV);
    expect(result.compressedBytes).toBe(gz.length);
    // Decompressed is larger than compressed — this is what lets callers distinguish
    // "empty report" from "downloaded plenty, parsed nothing".
    expect(result.decompressedBytes).toBe(Buffer.byteLength(TSV));
    expect(result.decompressedBytes).toBeGreaterThan(0);
  });

  test('works when the server sends no content-length (chunked)', async () => {
    handler = (req, res) => {
      res.writeHead(200); // no content-length → chunked
      res.write(TSV.slice(0, 4));
      res.end(TSV.slice(4));
    };

    const result = await downloadReportContent(`${baseUrl}/r`);

    expect(result.text).toBe(TSV);
  });

  test('an empty body is a valid zero-byte result, not an error', async () => {
    handler = (req, res) => {
      res.setHeader('content-length', 0);
      res.end('');
    };

    const result = await downloadReportContent(`${baseUrl}/r`);

    expect(result.text).toBe('');
    expect(result.compressedBytes).toBe(0);
  });
});

describe('truncation detection (silent-data-loss guard)', () => {
  test('rejects when fewer bytes arrive than content-length declares', async () => {
    handler = (req, res) => {
      // Declare 500, send 10, then close cleanly. The old implementation resolved here.
      res.setHeader('content-length', 500);
      res.write('0123456789');
      res.end();
    };

    await expect(downloadReportContent(`${baseUrl}/r`, { label: 'sales' }))
      .rejects.toThrow(/truncated download: received 10 of 500 bytes/);
  });

  test('rejects a truncated gzip stream rather than returning short text', async () => {
    const gz = zlib.gzipSync(Buffer.from(TSV.repeat(50)));
    handler = (req, res) => {
      res.writeHead(200);
      res.write(gz.subarray(0, Math.floor(gz.length / 2)));
      res.end();
    };

    await expect(downloadReportContent(`${baseUrl}/r`, { isGzip: true }))
      .rejects.toThrow(/gunzip failed/);
  });
});

describe('timeouts (job-lock protection)', () => {
  test('rejects when the transfer stalls mid-body', async () => {
    handler = (req, res) => {
      res.setHeader('content-length', 1000);
      res.write('partial'); // then never write again, never end
    };

    await expect(
      downloadReportContent(`${baseUrl}/r`, { idleTimeoutMs: 150, label: 'sales' })
    ).rejects.toThrow(/stalled — no data for/);
  });

  test('rejects when the server never responds at all', async () => {
    handler = () => { /* hold the request open, send nothing */ };

    await expect(
      downloadReportContent(`${baseUrl}/r`, { idleTimeoutMs: 150 })
    ).rejects.toThrow(/no response within/);
  });

  test('enforces the overall budget even while data keeps trickling', async () => {
    // Idle timer never fires because bytes keep arriving — only the overall cap can stop this.
    handler = (req, res) => {
      res.writeHead(200);
      const iv = setInterval(() => res.write('x'), 20);
      res.on('close', () => clearInterval(iv));
    };

    await expect(
      downloadReportContent(`${baseUrl}/r`, { timeoutMs: 250, idleTimeoutMs: 5000 })
    ).rejects.toThrow(/download exceeded 250ms \(received \d+ bytes\)/);
  });

  test('sub-second timeouts are reported in ms, never as "0s"', async () => {
    // These strings land in FinanceSyncLog.error, so "exceeded 0s" would be actively confusing.
    handler = () => { /* never respond */ };

    await expect(
      downloadReportContent(`${baseUrl}/r`, { idleTimeoutMs: 100 })
    ).rejects.toThrow(/no response within 100ms/);
  });

  test('a slow-but-progressing download still succeeds', async () => {
    handler = (req, res) => {
      res.writeHead(200);
      res.write('a\tb\n');
      setTimeout(() => res.end('1\t2\n'), 120);
    };

    const result = await downloadReportContent(`${baseUrl}/r`, {
      idleTimeoutMs: 1000,
      timeoutMs: 5000,
    });

    expect(result.text).toBe('a\tb\n1\t2\n');
  });
});

describe('size ceiling', () => {
  test('aborts once maxBytes is exceeded', async () => {
    handler = (req, res) => {
      res.writeHead(200);
      const iv = setInterval(() => res.write('x'.repeat(64)), 5);
      res.on('close', () => clearInterval(iv));
    };

    await expect(
      downloadReportContent(`${baseUrl}/r`, { maxBytes: 128, idleTimeoutMs: 2000 })
    ).rejects.toThrow(/exceeded SPAPI_REPORT_MAX_BYTES/);
  });

  test('maxBytes 0 means unlimited', async () => {
    handler = (req, res) => {
      res.setHeader('content-length', Buffer.byteLength(TSV));
      res.end(TSV);
    };

    await expect(
      downloadReportContent(`${baseUrl}/r`, { maxBytes: 0 })
    ).resolves.toMatchObject({ text: TSV });
  });
});

describe('HTTP errors', () => {
  test('a non-2xx status rejects with the code', async () => {
    handler = (req, res) => {
      res.writeHead(403);
      res.end('Forbidden');
    };

    await expect(downloadReportContent(`${baseUrl}/r`, { label: 'sales' }))
      .rejects.toThrow(/\[sales\] download failed: HTTP 403/);
  });

  test('a connection error rejects', async () => {
    // Port 1 is not listening.
    await expect(
      downloadReportContent('http://127.0.0.1:1/r', { idleTimeoutMs: 500 })
    ).rejects.toThrow(/download error/);
  });
});

describe('countNonEmptyLines', () => {
  test('counts non-blank lines and stops at the limit', () => {
    expect(countNonEmptyLines('a\nb\nc\n', 2)).toBe(2);
    expect(countNonEmptyLines('a\n', 2)).toBe(1);
    expect(countNonEmptyLines('', 2)).toBe(0);
    expect(countNonEmptyLines('   \n\t\n', 2)).toBe(0);
  });

  test('handles a body with no trailing newline', () => {
    expect(countNonEmptyLines('only-one-line', 2)).toBe(1);
  });

  test('handles CRLF line endings', () => {
    expect(countNonEmptyLines('a\r\nb\r\n', 2)).toBe(2);
  });
});

describe('isUnusableReportPayload — the header-only false-positive guard', () => {
  // This is the regression guard for a bug that would have re-created the original deadlock:
  // Amazon represents "no orders in this window" as a HEADER ROW ONLY. That is non-zero bytes
  // parsing to zero rows, so a naive `bytes > 0 && rows === 0` check rejected every quiet day,
  // marked it failed, and stalled the cursor on it forever.
  const HEADER = 'amazon-order-id\tpurchase-date\tsku\tquantity\titem-price\n';

  test('a header-only report is USABLE (a legitimately empty window)', () => {
    expect(isUnusableReportPayload(HEADER, Buffer.byteLength(HEADER))).toBe(false);
  });

  test('a header-only report with no trailing newline is also usable', () => {
    const h = HEADER.trimEnd();
    expect(isUnusableReportPayload(h, Buffer.byteLength(h))).toBe(false);
  });

  test('a zero-byte download is not flagged here (callers handle it)', () => {
    expect(isUnusableReportPayload('', 0)).toBe(false);
  });

  test('bytes with no usable line at all IS unusable', () => {
    expect(isUnusableReportPayload('   \n\n  \n', 40)).toBe(true);
  });

  test('a single line far too large to be a header IS unusable', () => {
    // e.g. a giant HTML error page or a body with no newlines at all.
    const huge = 'x'.repeat(HEADER_ONLY_MAX_BYTES + 1);
    expect(isUnusableReportPayload(huge, huge.length)).toBe(true);
  });

  test('a real report with data rows is usable', () => {
    const body = `${HEADER}111-1\t2026-07-01\tSKU\t1\t25.00\n`;
    expect(isUnusableReportPayload(body, Buffer.byteLength(body))).toBe(false);
  });
});

describe('env configuration', () => {
  test('idle timeout is read from SPAPI_REPORT_IDLE_TIMEOUT_MS', async () => {
    process.env.SPAPI_REPORT_IDLE_TIMEOUT_MS = '120';
    handler = (req, res) => {
      res.setHeader('content-length', 1000);
      res.write('partial');
    };

    await expect(downloadReportContent(`${baseUrl}/r`)).rejects.toThrow(/stalled/);
  });

  test('a malformed env value falls back to the default rather than NaN', async () => {
    process.env.SPAPI_REPORT_IDLE_TIMEOUT_MS = 'abc';
    handler = (req, res) => {
      res.setHeader('content-length', Buffer.byteLength(TSV));
      res.end(TSV);
    };

    // A NaN timeout would fire immediately and break every download.
    await expect(downloadReportContent(`${baseUrl}/r`)).resolves.toMatchObject({ text: TSV });
  });
});
