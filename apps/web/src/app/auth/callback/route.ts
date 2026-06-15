import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// OAuth (PKCE) callback. Supabase redirects here after Google with `?code=` on
// success, or `?error=` when sign-in is rejected — most commonly because the email
// isn't on the allowlist (the auth.users trigger from migration 0004 blocks the
// insert, which GoTrue surfaces as "Database error saving new user"). We exchange
// the code for a session cookie and land the user in the inbox, or bounce a
// friendly message back to /login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const errorDescription = searchParams.get('error_description') ?? '';

  const backToLogin = (msg: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`);

  if (oauthError) {
    const blocked = /not approved|allowlist|saving new user/i.test(errorDescription);
    return backToLogin(
      blocked
        ? 'This email isn’t approved for access yet. Ask an admin to add you.'
        : errorDescription || 'Sign-in failed. Please try again.',
    );
  }

  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return backToLogin(error.message);

  return NextResponse.redirect(`${origin}/inbox`);
}
