export interface EmailSequenceItem {
  day: number;
  subject: string;
  title: string;
  subtitle: string;
  greeting: string;
  intro: string;
  contentHtml: string;
  footer: string;
  action?: { label: string; url: string };
  plainText: string;
}

export function getFirstName(fullName: string | null | undefined): string {
  if (!fullName) return 'Notary';
  return fullName.split(' ')[0].trim();
}

export function getDelayMsToUsET10am(daysAhead: number): number {
  const now = Date.now();
  const roughTarget = now + daysAhead * 24 * 60 * 60 * 1000;
  for (
    let offset = -24 * 60 * 60 * 1000;
    offset <= 24 * 60 * 60 * 1000;
    offset += 5 * 60 * 1000
  ) {
    const candidate = new Date(roughTarget + offset);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(candidate);
    const hour = parts.find((p) => p.type === 'hour');
    const minute = parts.find((p) => p.type === 'minute');
    if (
      hour &&
      minute &&
      parseInt(hour.value, 10) === 10 &&
      parseInt(minute.value, 10) === 0
    ) {
      const delay = candidate.getTime() - now;
      return Math.max(0, delay);
    }
  }
  return Math.max(0, daysAhead * 24 * 60 * 60 * 1000);
}

function trialBannerHtml(trialDays?: number): string {
  if (!trialDays) return '';
  return `<div style="margin-top:18px;padding:12px 14px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;color:#475569;font-size:12px;line-height:1.6"><strong style="color:#0F2C4E">You're on Pro, free for ${trialDays} days.</strong> Every Pro feature is unlocked during your trial - no credit card required.</div>`;
}

function proTipBlock(): string {
  return `<div style="margin-top:18px;padding:12px 14px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;color:#475569;font-size:12px;line-height:1.6"><strong style="color:#0F2C4E">Pro tip:</strong> Use CITT before committing to a job to check schedule fit and profitability.</div>`;
}

const APP_URL = 'https://www.notaryday.app';

const DAY_0_CONTENT = (trialDays?: number): EmailSequenceItem => ({
  day: 0,
  subject: "You're in. Here's the fastest way to see it work",
  title: "You're in. Here's the fastest way to see it work",
  subtitle: 'Getting started with your notary workspace',
  greeting: '',
  intro:
    'Welcome to Notary Day. Your account is live, and Can I Take This? (CITT) is ready to use right now.',
  contentHtml:
    `<p style="font-size:13px;line-height:1.7;color:#475569">Here's the fastest way to see the value: the next time a job request lands in your inbox, don't decide by gut feel. Open Notary Day first, enter the address, the time, and the fee, and let CITT tell you your real drive time, what you will actually net after mileage, and whether it fits your day. It takes under a minute.</p><p style="font-size:13px;line-height:1.7;color:#475569;margin-top:12px">That one check is the whole point. Everything else builds on it.</p><p style="margin-top:16px"><a href="${APP_URL}" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">Try it on your very next job</a></p>` +
    proTipBlock() +
    trialBannerHtml(trialDays),
  footer: 'You are receiving this email because you signed up for Notary Day.',
  plainText:
    "Welcome to Notary Day. Your account is live, and Can I Take This? (CITT) is ready to use right now. Here's the fastest way to see the value: the next time a job request lands in your inbox, don't decide by gut feel. Open Notary Day first, enter the address, the time, and the fee, and let CITT tell you your real drive time, what you will actually net after mileage, and whether it fits your day. It takes under a minute. That one check is the whole point. Everything else builds on it. Try it on your very next job: https://www.notaryday.app",
});

const DAY_1_CONTENT = (): EmailSequenceItem => ({
  day: 1,
  subject: 'The part most people miss on day one',
  title: 'The part most people miss on day one',
  subtitle: 'CITT and scanback windows',
  greeting: '',
  intro:
    "Quick tip most new users miss in the first few days: CITT doesn't just check your earnings, it checks your time too.",
  contentHtml: `<p style="font-size:13px;line-height:1.7;color:#475569">If you take loan signings, every one of them comes with a scanback window afterward, the time you're required to stay nearby to scan and return documents. Notary Day already accounts for that automatically when you check a new job, so you'll see immediately if something you're about to accept would actually crash into it.</p><p style="margin-top:16px"><a href="${APP_URL}" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">If you haven't run a real job through CITT yet, today's a good day to start</a></p>`,
  footer: 'You are receiving this email because you are a Notary Day user.',
  plainText:
    "Quick tip most new users miss in the first few days: CITT doesn't just check your earnings, it checks your time too. If you take loan signings, every one of them comes with a scanback window afterward, the time you're required to stay nearby to scan and return documents. Notary Day already accounts for that automatically when you check a new job, so you'll see immediately if something you're about to accept would actually crash into it. If you haven't run a real job through CITT yet, today's a good day to start: https://www.notaryday.app",
});

const DAY_2_CONTENT = (): EmailSequenceItem => ({
  day: 2,
  subject: 'Let your calendar do the planning for you',
  title: 'Let your calendar do the planning for you',
  subtitle: 'Smart Day Planner',
  greeting: '',
  intro:
    "By now you've hopefully checked a job or two. Here's the next step: let Notary Day plan your whole day, not just one signing at a time.",
  contentHtml: `<p style="font-size:13px;line-height:1.7;color:#475569">Add your confirmed jobs for a day and the Smart Day Planner will sequence them in the most efficient order, automatically block scanback time on your calendar, and show you your estimated net earnings and total drive time before you even leave the house.</p><p style="margin-top:16px"><a href="${APP_URL}" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">Give it a try</a></p>`,
  footer: 'You are receiving this email because you are a Notary Day user.',
  plainText:
    "By now you've hopefully checked a job or two. Here's the next step: let Notary Day plan your whole day, not just one signing at a time. Add your confirmed jobs for a day and the Smart Day Planner will sequence them in the most efficient order, automatically block scanback time on your calendar, and show you your estimated net earnings and total drive time before you even leave the house. Give it a try: https://www.notaryday.app",
});

const DAY_3_CONTENT = (): EmailSequenceItem => ({
  day: 3,
  subject: "A gap in your schedule doesn't have to be wasted",
  title: "A gap in your schedule doesn't have to be wasted",
  subtitle: 'Gap Finder',
  greeting: '',
  intro: 'One more feature worth knowing about: Gap Finder.',
  contentHtml: `<p style="font-size:13px;line-height:1.7;color:#475569">If there's an open window in your day, say ninety minutes between two signings, Gap Finder automatically looks at pending job requests nearby and shows you the ones that would genuinely fit without adding real travel time. You just tap to check it with CITT before accepting.</p><p style="margin-top:16px"><a href="${APP_URL}" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">Take a look next time you have a gap</a></p>`,
  footer: 'You are receiving this email because you are a Notary Day user.',
  plainText:
    "One more feature worth knowing about: Gap Finder. If there's an open window in your day, say ninety minutes between two signings, Gap Finder automatically looks at pending job requests nearby and shows you the ones that would genuinely fit without adding real travel time. You just tap to check it with CITT before accepting. It's a small thing that adds up fast over a full week. Take a look next time you have a gap: https://www.notaryday.app",
});

const DAY_4_CONTENT = (): EmailSequenceItem => ({
  day: 4,
  subject: "How's it going so far?",
  title: "How's it going so far?",
  subtitle: 'Your feedback matters',
  greeting: '',
  intro:
    "You've had a few days with Notary Day now, so I wanted to check in directly. How is it fitting into your actual workflow?",
  contentHtml: `<p style="font-size:13px;line-height:1.7;color:#475569">If something feels clunky, missing, or confusing, just send us an email here.</p><p style="margin-top:16px"><a href="mailto:hello@notaryday.app" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">hello@notaryday.app</a></p><p style="margin-top:16px;color:#475569;font-size:13px;line-height:1.7">And if it's been useful, the next thing worth setting up is your booking page, so direct clients can book you without the back and forth.</p><p style="margin-top:16px"><a href="${APP_URL}" style="display:inline-block;background:#0E7B6C;color:#ffffff;text-decoration:none;border-radius:7px;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700">Set up your booking page</a></p>`,
  footer: 'You are receiving this email because you are a Notary Day user.',
  plainText:
    "You've had a few days with Notary Day now, so I wanted to check in directly. How is it fitting into your actual workflow? If something feels clunky, missing, or confusing, just send us an email here: hello@notaryday.app. And if it's been useful, the next thing worth setting up is your booking page, so direct clients can book you without the back and forth: https://www.notaryday.app",
});

export function getNewUserEmailSequence(
  firstName: string,
  trialDays?: number,
): EmailSequenceItem[] {
  const g = `Hi ${firstName},`;
  return [
    { ...DAY_0_CONTENT(trialDays), greeting: g },
    DAY_1_CONTENT(),
    DAY_2_CONTENT(),
    DAY_3_CONTENT(),
    DAY_4_CONTENT(),
  ].map((email) => ({ ...email, greeting: g }));
}

export function getExistingUserEmailSequence(
  firstName: string,
  trialDays?: number,
): EmailSequenceItem[] {
  const g = `Hi ${firstName},`;
  return [
    { ...DAY_0_CONTENT(trialDays), greeting: g },
    DAY_1_CONTENT(),
    DAY_2_CONTENT(),
    DAY_3_CONTENT(),
    DAY_4_CONTENT(),
  ].map((email) => ({ ...email, greeting: g }));
}
