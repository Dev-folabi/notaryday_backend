/**
 * Core profitability formula:
 *   net_earnings = fee - mileage_cost - platform_fee
 *   mileage_cost = distance_miles * 2 * irs_rate
 *   effective_hourly = net_earnings / total_duration_hrs
 */
export function calculateProfitability(params: {
  fee: number | { toString(): string };
  platformFee: number | { toString(): string };
  distanceMiles: number | { toString(): string };
  irsRatePerMile: number | { toString(): string };
  signingDurationMins: number;
  driveTimeMins: number;
  scanbackDurationMins?: number;
}): {
  mileageCost: number;
  netEarnings: number;
  effectiveHourly: number;
  totalJobMins: number;
} {
  const fee = Number(params.fee);
  const platformFee = Number(params.platformFee);
  const distanceMiles = Number(params.distanceMiles);
  const irsRate = Number(params.irsRatePerMile);
  const scanbackMins = params.scanbackDurationMins ?? 0;

  // Round-trip mileage cost
  const mileageCost = distanceMiles * 2 * irsRate;
  const netEarnings = fee - mileageCost - platformFee;

  // Total time: drive to job + signing + scanback (+ return drive not billed)
  const totalJobMins =
    params.driveTimeMins + params.signingDurationMins + scanbackMins;
  const totalJobHrs = totalJobMins / 60;
  const effectiveHourly = totalJobHrs > 0 ? netEarnings / totalJobHrs : 0;

  return {
    mileageCost: Math.round(mileageCost * 100) / 100,
    netEarnings: Math.round(netEarnings * 100) / 100,
    effectiveHourly: Math.round(effectiveHourly * 100) / 100,
    totalJobMins,
  };
}
