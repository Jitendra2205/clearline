import { isAuthed, authEnabled } from '@/lib/security/auth';
import LoginForm from '@/components/LoginForm';

/** No unauthenticated route reaches vendor pricing. */
export default async function RfxLayout({ children }: { children: React.ReactNode }) {
  if (authEnabled() && !(await isAuthed())) return <LoginForm />;
  return <>{children}</>;
}
