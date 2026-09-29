-- Persist upstream provider identifiers for end-to-end runtime evidence.
-- These values are non-secret correlation identifiers returned by providers.
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS provider_response_id text;

CREATE INDEX IF NOT EXISTS requests_provider_request_idx
  ON public.requests (org_id, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

COMMENT ON COLUMN public.requests.provider_request_id IS
  'Upstream provider request/correlation identifier, when returned by the provider.';
COMMENT ON COLUMN public.requests.provider_response_id IS
  'Provider response object identifier, when returned by the provider.';
