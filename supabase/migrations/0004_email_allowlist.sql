-- ============================================================================
-- Email allowlist for self-serve (Google OAuth) registration.
--
-- Registration is GATED, not open: a new auth.users row is only permitted if its
-- email is present in public.allowed_emails. Enforced by a BEFORE INSERT trigger
-- on auth.users — server-side, so no client (or stolen anon key) can bypass it.
-- Applies to every creation path: Google OAuth, email/password, dashboard "Add
-- user".
--
-- To onboard someone: INSERT their email here FIRST, then they "Continue with
-- Google" (which auto-creates their user and passes the check).
--
-- Security (CONTRACTS §5): allowed_emails has RLS enabled with NO client policy —
-- only the dashboard / service_role (BYPASSRLS) manages it; anon/authenticated
-- get zero access (deny-by-default).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.allowed_emails (
  email       TEXT PRIMARY KEY,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;  -- no client policy: admin-only.

-- Case-insensitive gate. SECURITY DEFINER so it reads allowed_emails despite RLS;
-- locked search_path so the function can't be hijacked (advisor 0011).
CREATE OR REPLACE FUNCTION public.enforce_email_allowlist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE lower(email) = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION 'email % is not approved for registration', NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_allowlist_before_user_insert ON auth.users;
CREATE TRIGGER enforce_allowlist_before_user_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_email_allowlist();

-- Seed the admin so the first login isn't locked out of its own system.
INSERT INTO public.allowed_emails (email, note)
VALUES ('will@willdayble.com', 'admin / builder')
ON CONFLICT (email) DO NOTHING;
