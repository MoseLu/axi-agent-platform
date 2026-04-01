import { Routes, Route } from 'react-router-dom'
import Layout from './components/common/Layout'
import Dashboard from './pages/Dashboard'
import Agents from './pages/Agents'
import Tasks from './pages/Tasks'
import Tools from './pages/Tools'
import Memory from './pages/Memory'
import Settings from './pages/Settings'
import SubAgent from './pages/SubAgent'
import Chat from './pages/Chat'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

export default App
