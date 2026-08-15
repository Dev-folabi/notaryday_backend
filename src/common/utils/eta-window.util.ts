/**
 * Window used to decide whether a client ETA email is appropriate to send.
 * The ETA is meant for "the notary is heading over now": it only makes sense
 * when the next appointment is close enough that leaving immediately (arrival
 * = now + drive time) lands within these bounds.
 */
export const ETA_WAIT_BUFFER_MIN = 45; // appointment may be up to drive time + 45 min away
export const ETA_LATE_TOLERANCE_MIN = 15; // appointment may be at most 15 min before leaving-now arrival

export function isEtaSendAppropriate(
  appointmentTime: Date,
  driveMins: number,
  now: Date = new Date(),
): boolean {
  const diffMin =
    (appointmentTime.getTime() - (now.getTime() + driveMins * 60_000)) / 60_000;
  return diffMin <= ETA_WAIT_BUFFER_MIN && diffMin >= -ETA_LATE_TOLERANCE_MIN;
}
