import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { usePlatform } from './context/PlatformContext'
import { LoginPage } from './pages/LoginPage'
import { ParentReportsPage } from './pages/parent/ParentReportsPage'
import { MessagesPage } from './pages/student/MessagesPage'
import { LearningResourcesPage } from './pages/student/LearningResourcesPage'
import { MistakesPage } from './pages/student/MistakesPage'
import { StudentDashboard } from './pages/student/StudentDashboard'
import { TutorPage } from './pages/student/TutorPage'
import { UploadPage, WrongUploadPage } from './pages/student/UploadPage'
import { AccountsPage } from './pages/teacher/AccountsPage'
import { KnowledgePage } from './pages/teacher/KnowledgePage'
import { ReportsPage } from './pages/teacher/ReportsPage'
import { ReviewPage } from './pages/teacher/ReviewPage'
import { SettingsPage } from './pages/teacher/SettingsPage'
import { StudentsPage } from './pages/teacher/StudentsPage'
import { StudentQuestionBankPage } from './pages/teacher/StudentQuestionBankPage'
import { TeacherDashboard } from './pages/teacher/TeacherDashboard'

function HomeRedirect() {
  const { state } = usePlatform()
  return <Navigate replace to={state.currentUser.role === 'teacher' ? '/teacher' : state.currentUser.role === 'student' ? '/student' : '/parent'} />
}

function RoleGate({ role }: { role: 'teacher' | 'student' | 'parent' }) {
  const { state } = usePlatform()
  return state.currentUser.role === role ? <Outlet /> : <HomeRedirect />
}

export default function App() {
  const { loading, authenticated } = usePlatform()
  if (loading) return <div className="app-loading"><LoaderCircle className="spin" size={28} /><span>正在载入工作台</span></div>

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={authenticated ? <AppShell /> : <Navigate replace to="/login" />}>
        <Route index element={<HomeRedirect />} />
        <Route element={<RoleGate role="teacher" />}>
          <Route path="teacher" element={<TeacherDashboard />} />
          <Route path="teacher/review" element={<ReviewPage />} />
          <Route path="teacher/students" element={<StudentsPage />} />
          <Route path="teacher/question-bank" element={<StudentQuestionBankPage />} />
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
