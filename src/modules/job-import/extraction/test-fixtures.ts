/** Realistic signing-order emails used across extraction tests. */

export const SNAPDOCS_EMAIL = `New Signing Order

Dear Notary,

You have been assigned a new signing order.

Signing Type: Loan Refinance
Date & Time: August 28, 2026 at 2:30 PM EST
Address: 456 Oak Avenue, Suite 200, Tampa, FL 33601
Fee: $175.00
Platform Fee: $25.00
Client: First National Bank
Borrower: James Rodriguez
Borrower Phone: (813) 555-0199
Platform: SnapDocs

Please arrive 10 minutes early. Contact the borrower if you have questions.

Thank you,
SnapDocs Signing Services`;

export const TITLESMART_EMAIL = `Confirmation of Signing

Signing date: 08/28/2026
Time: 14:30

Location: 789 Pine Road, Apt 3B, Austin TX 78704

Loan amount: $310,000.00
Notary fee: 150
Order type: Purchase Closing
Homeowner: Sarah Mitchell
Phone: 512-555-1234
Title Company: TitleSmart

Special instructions: Bring wet ink documents. 2 signers.`;

export const MINIMAL_EMAIL = `You have a signing appointment at 123 Main Street, Springfield, IL 62704 on September 1, 2026 at 10:00 AM. Fee $120.`;

export const GARBAGE_EMAIL = `Hi,

Just following up on last week. Let me know if you need anything else.

Best,
Alex`;

export const HTML_EMAIL = `<html><body><p>Signing Type: Hybrid</p><p>Date: Sept 2, 2026 9:15 AM</p><p>Address: 12 Broadway Ave, New York, NY 10001</p><p>Fee: $200</p></body></html>`;

/** A direct (typed, non-forwarded) email — the control case. */
export const DIRECT_EMAIL = `New Signing Order

Dear Notary,

You have been assigned a new signing order.

Signing Type: Loan Refinance
Date & Time: August 28, 2026 at 2:30 PM EST
Address: 456 Oak Avenue, Suite 200, Tampa, FL 33601
Fee: $175.00
Platform Fee: $25.00
Client: First National Bank
Borrower: James Rodriguez
Borrower Phone: (813) 555-0199
Platform: SnapDocs

Please arrive 10 minutes early. Contact the borrower if you have questions.

Thank you,
SnapDocs Signing Services`;

/** Same job forwarded through Gmail (header block + quoted body). */
export const GMAIL_FORWARDED_EMAIL = `Hi,

---------- Forwarded message ----------
From: SnapDocs <orders@snapdocs.com>
Date: Thu, Aug 28, 2026 at 2:30 PM
Subject: New Signing Order
To: notary@example.com

New Signing Order

Dear Notary,

You have been assigned a new signing order.

Signing Type: Loan Refinance
Date & Time: August 28, 2026 at 2:30 PM EST
Address: 456 Oak Avenue, Suite 200, Tampa, FL 33601
Fee: $175.00
Platform Fee: $25.00
Client: First National Bank
Borrower: James Rodriguez
Borrower Phone: (813) 555-0199
Platform: SnapDocs

Please arrive 10 minutes early. Contact the borrower if you have questions.

Thank you,
SnapDocs Signing Services`;

/** Same job forwarded through Outlook ("Begin forwarded message:"). */
export const OUTLOOK_FORWARDED_EMAIL = `Please add to my schedule.

Begin forwarded message:

From: SnapDocs <orders@snapdocs.com>
Sent: Friday, August 28, 2026 2:30 PM
To: notary@example.com
Cc: team@example.com
Subject: New Signing Order

New Signing Order

Dear Notary,

You have been assigned a new signing order.

Signing Type: Loan Refinance
Date & Time: August 28, 2026 at 2:30 PM EST
Address: 456 Oak Avenue, Suite 200, Tampa, FL 33601
Fee: $175.00
Platform Fee: $25.00
Client: First National Bank
Borrower: James Rodriguez
Borrower Phone: (813) 555-0199
Platform: SnapDocs

Please arrive 10 minutes early. Contact the borrower if you have questions.

Thank you,
SnapDocs Signing Services`;
