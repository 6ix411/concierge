-- Stage 13: dispute statuses are now open, under_review, escalated, resolved and closed.
--   resolved   the Concierge team decided for the business or the customer
--   escalated  needs a senior decision or outside action (payment provider, legal) before it's decided
--   closed     ended without a decision for either side: dismissed, or withdrawn by whoever opened it
-- Kept in its own migration so the new value is committed before anything uses it.

alter type public.dispute_status rename value 'rejected' to 'closed';
alter type public.dispute_status add value if not exists 'escalated' after 'under_review';
