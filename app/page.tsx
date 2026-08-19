import { redirect } from 'next/navigation';

// Setara index.php: header("Location: /dashboard.html"); exit;
export default function Home() {
  redirect('/dashboard.html');
}
