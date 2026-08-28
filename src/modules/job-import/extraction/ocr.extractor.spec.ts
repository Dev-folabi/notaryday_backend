import { OCRExtractor } from './ocr.extractor';
import * as tesseract from 'tesseract.js';

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}));

describe('OCRExtractor (robustness)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns recognized text on success', async () => {
    (tesseract.createWorker as jest.Mock).mockResolvedValue({
      recognize: jest.fn().mockResolvedValue({ data: { text: '123 Main St' } }),
    });
    const ocr = new OCRExtractor();
    const text = await ocr.extractText(Buffer.from('img'));
    expect(text).toBe('123 Main St');
  });

  it('rejects (does not hang forever) when createWorker never settles', async () => {
    // tesseract.js createWorker can return a promise that never settles.
    (tesseract.createWorker as jest.Mock).mockReturnValue(
      new Promise(() => {}),
    );
    const ocr = new OCRExtractor({ workerCreateTimeoutMs: 50 });
    await expect(ocr.extractText(Buffer.from('img'))).rejects.toThrow(
      /timed out/i,
    );
  });

  it('rejects when recognition never settles', async () => {
    (tesseract.createWorker as jest.Mock).mockResolvedValue({
      recognize: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const ocr = new OCRExtractor({ recognizeTimeoutMs: 50 });
    await expect(ocr.extractText(Buffer.from('img'))).rejects.toThrow(
      /timed out/i,
    );
  });

  it('does not poison the queue: a failed OCR does not break the next call', async () => {
    const recognize = jest
      .fn()
      .mockReturnValueOnce(new Promise(() => {})) // first call hangs
      .mockResolvedValueOnce({ data: { text: 'recovered' } });
    (tesseract.createWorker as jest.Mock).mockResolvedValue({ recognize });

    const ocr = new OCRExtractor({ recognizeTimeoutMs: 50 });
    await expect(ocr.extractText(Buffer.from('a'))).rejects.toThrow(
      /timed out/i,
    );
    const second = await ocr.extractText(Buffer.from('b'));
    expect(second).toBe('recovered');
  });
});
