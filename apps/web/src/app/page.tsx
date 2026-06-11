import { redirect } from 'next/navigation';

// Entry point — middleware sends anonymous users to /login; everyone else lands
// in the inbox (the core conversations→bookings surface).
export default function Home() {
  redirect('/inbox');
}
