-- Stage 9: booking engine, part 1.
-- New booking states. Enum values must be committed before they can be used, so the rest of the
-- booking engine is in the next migration.
--
--   requested → pending_provider → accepted → payment_pending → confirmed → in_progress → completed → reviewed
--   plus declined, cancelled, disputed and refunded (and the existing quoted and expired).

alter type public.booking_status rename value 'rejected' to 'declined';
alter type public.booking_status add value if not exists 'pending_provider' after 'requested';
alter type public.booking_status add value if not exists 'payment_pending' after 'accepted';
alter type public.booking_status add value if not exists 'reviewed' after 'completed';
alter type public.booking_status add value if not exists 'refunded' after 'disputed';
