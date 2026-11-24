import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ThemeProvider } from './theme/ThemeContext'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { OnboardingGate } from './auth/OnboardingGate'
import { AdminRoute } from './auth/AdminRoute'
import { DashboardLayout } from './components/DashboardLayout'
import { ScrollToTop } from './components/ScrollToTop'
import { ImpersonationBanner } from './components/ImpersonationBanner'
import { LandingPage } from './pages/Landing'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { HowItWorksPage } from './pages/HowItWorks'
import { ScoringPage } from './pages/Scoring'
import { SourcesPage } from './pages/Sources'
import { DashboardPage } from './pages/Dashboard'
import { SyncPage } from './pages/Sync'
import { ProfilePage } from './pages/Profile'
import { OnboardingPage } from './pages/Onboarding'
import { CvPage } from './pages/Cv'
import { AddJobPage } from './pages/AddJob'
import { JobsPage } from './pages/Jobs'
import { SuggestionsPage } from './pages/Suggestions'
import { JobDetailPage } from './pages/JobDetail'
import { MyJobDetailPage } from './pages/MyJobDetail'
import { CommunityJobDetailPage } from './pages/CommunityJobDetail'
import { ApplicationsPage } from './pages/Applications'
import { AdminOverviewPage } from './pages/admin/AdminOverview'
import { AdminUsersPage } from './pages/admin/AdminUsers'
import { SettingsPage } from './pages/Settings'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <ImpersonationBanner />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/scoring" element={<ScoringPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route path="/community-jobs/:id" element={<CommunityJobDetailPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<OnboardingGate />}>
                <Route path="/my-jobs/:id" element={<MyJobDetailPage />} />
                <Route element={<DashboardLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/suggestions" element={<SuggestionsPage />} />
                  <Route path="/add-job" element={<AddJobPage />} />
                  <Route path="/sync" element={<SyncPage />} />
                  <Route path="/applications" element={<ApplicationsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/cv" element={<CvPage />} />
                  {/* Admin dashboard, inside the shell so it keeps the sidebar. The
                      sidebar's User | Admin switch toggles between these and the user nav. */}
                  <Route element={<AdminRoute />}>
                    <Route path="/admin" element={<AdminOverviewPage />} />
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
          {/* Mounted at the app root — outside every page's `.page-enter` wrapper,
              whose transform would otherwise become the containing block for the
              toaster's position:fixed and push it off-screen. */}
          <Toaster position="bottom-right" theme="system" toastOptions={{ className: 'type-pro' }} />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
