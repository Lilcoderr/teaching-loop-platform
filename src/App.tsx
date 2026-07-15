import { LoaderCircle } from 'lucide-react'
import { lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { usePlatform } from './context/PlatformContext'
import { LoginPage } from './pages/LoginPage'

const ParentReportsPage = lazy(() => import('./pages/parent/ParentReportsPage').then((module) => ({ default: module.ParentReportsPage })))
const MessagesPage = lazy(() => import('./pages/student/MessagesPage').then((module) => ({ default: module.MessagesPage })))
const LearningResourcesPage = lazy(() => import('./pages/student/LearningResourcesPage').then((module) => ({ default: module.LearningResourcesPage })))
const MistakesPage = lazy(() => import('./pages/student/MistakesPage').then((module) => ({ default: module.MistakesPage })))
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard').then((module) => ({ default: module.StudentDashboard })))
const TutorPage = lazy(() => import('./pages/student/TutorPage').then((module) => ({ default: module.TutorPage })))
const UploadPage = lazy(() => import('./pages/student/UploadPage').then((module) => ({ default: module.UploadPage })))
const WrongUploadPage = lazy(() => import('./pages/student/UploadPage').then((module) => ({ default: module.WrongUploadPage })))
const AccountsPage = lazy(() => import('./pages/teacher/AccountsPage').then((module) => ({ default: module.AccountsPage })))
const KnowledgePage = lazy(() => import('./pages/teacher/KnowledgePage').then((module) => ({ default: module.KnowledgePage })))
const ReportsPage = lazy(() => import('./pages/teacher/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const ReviewPage = lazy(() => import('./pages/teacher/ReviewPage').then((module) => ({ default: module.ReviewPage })))
const SettingsPage = lazy(() => import('./pages/teacher/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const StudentsPage = lazy(() => import('./pages/teacher/StudentsPage').then((module) => ({ default: module.StudentsPage })))
const StudentQuestionBankPage = lazy(() => import('./pages/teacher/StudentQuestionBankPage').then((module) => ({ default: module.StudentQuestionBankPage })))
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard').then((module) => ({ default: module.TeacherDashboard })))

function HomeRedirect() {
  const { state } = usePlatform()
  return <Navigate replace to={state.currentUser.role === 'teacher' ? '/teacher' : state.currentUser.role === 'student' ? '/student' : '/parent'} />
}

function RoleGate({ role }: { role: 'teacher' | 'student' | 'parent' }) {
  const { state } = usePlatform()
  return state.currentUser.role === role ? <Outlet /> : <HomeRedirect />
}

export default function App() {
  const { loading, authenticated, demoMode } = usePlatform()
  if (loading) return <div className="app-loading"><LoaderCircle className="spin" size={28} /><span>正在载入工作台</span></div>

  return (
    <Routes>
      <Route path="/login" element={authenticated && !demoMode ? <HomeRedirect /> : <LoginPage />} />
      <Route element={authenticated ? <AppShell /> : <Navigate replace to="/login" />}>
        <Route index element={<HomeRedirect />} />
        <Route element={<RoleGate role="teacher" />}>
          <Route path="teacher" element={<TeacherDashboard />} />
          <Route path="teacher/review" element={<ReviewPage />} />
          <Route path="teacher/students" element={<StudentsPage />} />
          <Route path="teacher/question-bank" element={<StudentQuestionBankPage />} />
          <Route path="teacher/wrong-items" element={<StudentQuestionBankPage />} />
          <Route path="teacher/knowledge" element={<KnowledgePage />} />
          <Route path="teacher/reports" element={<ReportsPage />} />
          <Route path="teacher/accounts" element={<AccountsPage />} />
          <Route path="teacher/settings" element={<SettingsPage />} />
        </Route>
        <Route element={<RoleGate role="student" />}>
          <Route path="student" element={<StudentDashboard />} />
          <Route path="student/upload" element={<UploadPage />} />
          <Route path="student/wrong-upload" element={<WrongUploadPage />} />
          <Route path="student/resources" element={<LearningResourcesPage />} />
          <Route path="student/mistakes" element={<MistakesPage />} />
          <Route path="student/tutor" element={<TutorPage />} />
          <Route path="student/messages" element={<MessagesPage />} />
        </Route>
        <Route element={<RoleGate role="parent" />}>
          <Route path="parent" element={<ParentReportsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}
