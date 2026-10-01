-- Stage 4: business statuses match the onboarding flow.
--   draft         still filling in the registration (not yet submitted)
--   pending       submitted, waiting for the platform to pick it up
--   under_review  the platform is reviewing it
--   approved      live: visible to customers and the concierge
--   rejected      not approved; the owner can fix and resubmit
--   suspended     taken down by the platform
-- Kept in its own migration: a new enum value can't be used in the transaction that adds it.

alter type public.business_status rename value 'pending_review' to 'pending';
alter type public.business_status add value if not exists 'under_review' after 'pending';
