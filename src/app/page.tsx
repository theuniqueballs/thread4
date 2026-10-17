import DashboardPage from './dashboard/page'

/**
 * `/` — the only user-visible route — renders the THREAD 4 pipeline
 * console. The full implementation lives in `src/app/dashboard/page.tsx`
 * (same component, also served at `/dashboard`).
 */
export default function Page() {
  return <DashboardPage />
}
