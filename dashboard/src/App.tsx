import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './theme/ThemeContext'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AdminRoute } from './auth/AdminRoute'
import { DashboardLayout } from './components/DashboardLayout'
import { LandingPage } from './pages/Landing'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { HowItWorksPage } from './pages/HowItWorks'
import { ScoringPage } from './pages/Scoring'
import { SourcesPage } from './pages/Sources'
import { DashboardPage } from './pages/Dashboard'
import { SyncPage } from './pages/Sync'
import { ProfilePage } from './pages/Profile'
import { CvPage } from './pages/Cv'
import { JobsPage } from './pages/Jobs'
import { JobDetailPage } from './pages/JobDetail'
import { ApplicationsPage } from './pages/Applications'
import { AdminPage } from './pages/Admin'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/scoring" element={<ScoringPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/sync" element={<SyncPage />} />
                <Route path="/applications" element={<ApplicationsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/cv" element={<CvPage />} />
              </Route>
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
