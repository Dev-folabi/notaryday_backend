import {
  isEtaSendAppropriate,
  ETA_WAIT_BUFFER_MIN,
  ETA_LATE_TOLERANCE_MIN,
} from './eta-window.util';

describe('isEtaSendAppropriate', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  // offset is the difference between the appointment and leaving-now arrival
  // (now + driveMins): positive means arriving early (waiting), negative late.
  const at = (offsetMin: number, driveMins = 20) =>
    new Date(now.getTime() + (driveMins + offsetMin) * 60_000);

  it('is true when leaving now arrives right on time', () => {
    expect(isEtaSendAppropriate(at(0), 20, now)).toBe(true);
  });

  it('is true up to the wait buffer', () => {
    expect(isEtaSendAppropriate(at(ETA_WAIT_BUFFER_MIN), 20, now)).toBe(true);
    expect(isEtaSendAppropriate(at(ETA_WAIT_BUFFER_MIN + 0.1), 20, now)).toBe(
      false,
    );
  });

  it('is true up to the late tolerance', () => {
    expect(isEtaSendAppropriate(at(-ETA_LATE_TOLERANCE_MIN), 20, now)).toBe(
      true,
    );
    expect(
      isEtaSendAppropriate(at(-ETA_LATE_TOLERANCE_MIN - 0.1), 20, now),
    ).toBe(false);
  });

  it('is false for a far-future appointment', () => {
    expect(
      isEtaSendAppropriate(new Date(now.getTime() + 24 * 60 * 60_000), 20, now),
    ).toBe(false);
  });

  it('is false for an appointment well in the past', () => {
    expect(
      isEtaSendAppropriate(new Date(now.getTime() - 60 * 60_000), 20, now),
    ).toBe(false);
  });
});
