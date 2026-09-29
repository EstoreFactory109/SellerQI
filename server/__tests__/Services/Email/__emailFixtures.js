/**
 * Real email SHAPES from the support@ inbox, with the identities replaced.
 *
 * The structures are the point and they are reproduced exactly: a Gmail header wrapped
 * across two lines, answers typed under ">" quoted questions, an Outlook rule line, the
 * Zoho ticket mirror banner, a forwarded Amazon notice. Every one of these defeated some
 * part of the quote handling when it arrived.
 *
 * The NAMES, addresses, phone numbers, case numbers and ASINs are not real. The originals
 * carried genuine third-party identity, and a repo whose stated premise is that client
 * identity never lands on disk should not keep a file full of it in its test tree. They
 * are re-keyed to the fictional client every other suite here already uses — Nitesh Kumar
 * / walmart@morgansrepellent.com / 913-269-8400 — so the existing LEAKED/IDENTIFYING
 * regexes work against these too.
 *
 * Not matched by testMatch ('**\/*.test.js'); follows the __itemModelMocks.js precedent.
 */

/**
 * Apple Mail. The client answered both questions by typing INSIDE the quote — "2500
 * sets." and the oz correction. This is the email that proved the bug: the quote cut kept
 * 3 lines of 56 and both answers went with it.
 */
const INLINE_ANSWERS = `Hi Nora,

Thank you for the detailed information. Please find below information for your reference. Kindly let me know if you need anything else. Thank you.

> 1. B0FS464345 – Black Portion Cups with Clear Lids 3.25 oz
> The current listing does not specify a pack count, so we have intentionally not included a quantity claim anywhere in the SEO document.
> Could you please confirm the correct pack size/quantity? 2500 sets.
>
>
>
>
> 2. B0FS98Q9VH – Black Portion Cups with Clear Lids
> The ASIN title specifies 4.5 oz, while the shared bullet copy for this product family lists 2 oz / 3.25 oz / 4 oz / 5.5 oz.
> Could you please confirm whether this variant should be 4 oz or 4.5 oz so we can ensure the SEO content accurately reflects the product? Sorry for the type, it shound be 4.5 oz
Warm Regards,

Nitesh Kumar
Natural Environmental Solutions
913-269-8400
walmart@morgansrepellent.com

> On Sep 21, 2026, at 2:30 AM, Support eStore Factory <hello@estorefactory.com> wrote:
>
>
> Hi Nitesh,
>
> I hope you’re doing well.
>
> We’ve completed the SEO content for the following products and are sharing the documents below for your review.
>
> Black Portion Cups with Clear Lids 3.25 oz — B0FS464345
> https://docs.google.com/document/d/1P3VDdAqxB-ZgY1euZvB3f5CJ7YP1N2FA61RYx102wFo/edit
>
> Two Details to Confirm
>
> Before we proceed further, could you please help us confirm the following two product details?
>
> 1. B0FS464345 – Black Portion Cups with Clear Lids 3.25 oz
> The current listing does not specify a pack count, so we have intentionally not included a quantity claim anywhere in the SEO document.
> Could you please confirm the correct pack size/quantity?
>
> 2. B0FS98Q9VH – Black Portion Cups with Clear Lids
> The ASIN title specifies 4.5 oz, while the shared bullet copy for this product family lists 2 oz / 3.25 oz / 4 oz / 5.5 oz.
> Could you please confirm whether this variant should be 4 oz or 4.5 oz so we can ensure the SEO content accurately reflects the product?
>
> Once we have these two confirmations, we can make any necessary adjustments accordingly.
>
> Best regards,
> Nora
>
> Nora Shah
> eStore Factory
> Project Coordinator
> +1 (818) 308-1444`;

/** Our email that INLINE_ANSWERS replied to, as we would have sent it. */
const INLINE_ANSWERS_PREVIOUS = `Hi Nitesh,

I hope you’re doing well.

We’ve completed the SEO content for the following products and are sharing the documents below for your review.

Black Portion Cups with Clear Lids 3.25 oz — B0FS464345
https://docs.google.com/document/d/1P3VDdAqxB-ZgY1euZvB3f5CJ7YP1N2FA61RYx102wFo/edit

Two Details to Confirm

Before we proceed further, could you please help us confirm the following two product details?

1. B0FS464345 – Black Portion Cups with Clear Lids 3.25 oz
The current listing does not specify a pack count, so we have intentionally not included a quantity claim anywhere in the SEO document.
Could you please confirm the correct pack size/quantity?

2. B0FS98Q9VH – Black Portion Cups with Clear Lids
The ASIN title specifies 4.5 oz, while the shared bullet copy for this product family lists 2 oz / 3.25 oz / 4 oz / 5.5 oz.
Could you please confirm whether this variant should be 4 oz or 4.5 oz so we can ensure the SEO content accurately reflects the product?

Once we have these two confirmations, we can make any necessary adjustments accordingly.

Best regards,
Nora

Nora Shah
eStore Factory
Project Coordinator
+1 (818) 308-1444`;

/**
 * The SAME previous email as the portal actually stores it — redacted.
 *
 * This is the one the ingest path can really retrieve, because no raw body is ever kept.
 * Note "Hi [name]," where the client's copy says "Hi Nitesh,": diffed literally, the
 * client's own name reads as a word they just typed.
 */
const INLINE_ANSWERS_PREVIOUS_REDACTED = INLINE_ANSWERS_PREVIOUS
    .replace('Hi Nitesh,', 'Hi [name],')
    .replace(/https:\/\/docs\.google\.com\/\S+/g, '[link]')
    .replace('+1 (818) 308-1444', '[phone]');

/**
 * An ordinary top reply, Gmail, with the header WRAPPED across two lines — the form
 * emailRichText's single-line marker does not match. The signature sits below the quote.
 * Must yield zero inline replies.
 */
const TOP_REPLY_GMAIL = `Hi Rohit,

Thanks, I’ve now reviewed the three updated listings together and I’m happy
with the overall direction and positioning across the range.

I just have one final correction before approval.

Please use the *VERISOL® registered trademark consistently across all three
listings*. VeriBerry is correct, however Glow Naked still uses “VERISOL”
without the ®.

Once this is addressed, please consider the listing copy approved from my
side.

Thanks,
Nitesh

On Fri, 25 Sept 2026 at 20:16, Support eStore Factory <
hello@estorefactory.com> wrote:

> Hello Nitesh,
>
> Please check below files
>
> • VeriBerry Skin:
> https://docs.google.com/document/d/1bAFF6l6qQUOMJgpFEjEpjifuPEPFLYNpTIfuc90-skQ/edit
>
> Best Regards,
> *Rohit Rathi*
> eStore Factory
> Project Coordinator
> +1 (818) 308-1444 <(818)%20308-1444>
>

--
Kind Regards,
Nitesh
913-269-8400`;

const TOP_REPLY_GMAIL_PREVIOUS = `Hello Nitesh,

Please check below files

• VeriBerry Skin:
https://docs.google.com/document/d/1bAFF6l6qQUOMJgpFEjEpjifuPEPFLYNpTIfuc90-skQ/edit

Best Regards,
Rohit Rathi
eStore Factory
Project Coordinator
+1 (818) 308-1444`;

/** Outlook top reply — the rule line then From:/Sent:. Body must stop before it. */
const TOP_REPLY_OUTLOOK = `Need one change: Pure Elegance Cotton & Modal Diamond Jacquard Bathrobe (B0981F9K2L)
https://docs.google.com/document/d/1oDK1xF6ySqJsN1EWGO7tD31YbKvpMJ5AywQl0tyknFQ/edit

Change: (Take out %)
Change to Cotton-Modal Fabric Blend: This robe combines modal, cotton, and polyester for a smooth, silky texture.

The rest are approved.

Nitesh

Nitesh Kumar
President of Natural Environmental Solutions
Office: 913-269-8400
Email: walmart@morgansrepellent.com

________________________________
From: Support eStore Factory <hello@estorefactory.com>
Sent: Tuesday, September 22, 2026 5:54 PM
To: Nitesh Kumar <walmart@morgansrepellent.com>
Subject: [EXTERNAL]PLOs Submitted for Review & Approval

Hi,

I’m sharing the completed PLOs for the following seven bathrobe products for your review and approval:`;

/** Answers typed BETWEEN our lines in Outlook — no ">" markers anywhere. */
const OUTLOOK_INLINE = `Answers below in caps.

________________________________
From: Support eStore Factory <hello@estorefactory.com>
Sent: Monday, September 21, 2026 9:00 AM
To: Client
Subject: Questions

Hi,

1. Which marketplace should we launch first?
US FIRST, THEN CANADA
2. Should we include the bundle SKU KB-100?
NO, LEAVE THE BUNDLE OUT FOR NOW

Best regards,
Nora`;

const OUTLOOK_INLINE_PREVIOUS = `Hi,

1. Which marketplace should we launch first?
2. Should we include the bundle SKU KB-100?

Best regards,
Nora`;

/** A genuine third-party forward. Belongs in `forwarded`, not `quoted`. */
const FORWARDED = `I believe that having inventory measured as I stated over a month ago not
to request this process does not benefit relations with Amazon.

---------- Forwarded message ---------
From: The Fulfillment by Amazon team <donotreply@amazon.com>
Date: Wed, Sep 23, 2026 at 7:04 PM
Subject: Remove aged, stranded, and unfulfillable inventory by 22nd Oct 2026

Starting 22nd Oct 2026, your Fulfillment by Amazon (FBA) inventory...`;

/**
 * A Zoho ticket comment. The mirror banner is quoted history, not a client forward, and
 * emailRichText knows nothing about it — so today the whole mirror passes through.
 */
const ZOHO_MIRROR = `Sender: Natural Environmental Solutions

That would be great to check expiration dates. Thank you so much.

****** FWD MESSAGE ******
Hi Nitesh,

Yes, if the inventory is physically available in Amazon's warehouse, we can create a case with Amazon Support and request a bin check.`;

module.exports = {
    INLINE_ANSWERS,
    INLINE_ANSWERS_PREVIOUS,
    INLINE_ANSWERS_PREVIOUS_REDACTED,
    TOP_REPLY_GMAIL,
    TOP_REPLY_GMAIL_PREVIOUS,
    TOP_REPLY_OUTLOOK,
    OUTLOOK_INLINE,
    OUTLOOK_INLINE_PREVIOUS,
    FORWARDED,
    ZOHO_MIRROR,
};
