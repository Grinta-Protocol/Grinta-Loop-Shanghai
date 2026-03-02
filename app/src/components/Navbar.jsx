import { Link, useLocation } from 'react-router-dom'
import ConnectButton from './ConnectButton.jsx'
import './Navbar.css'

export default function Navbar() {
  const { pathname } = useLocation()
  const isApp = pathname === '/app'

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo">
        Grinta
      </Link>
      <div className="navbar-links">
        <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://docs.grinta.xyz" target="_blank" rel="noopener noreferrer">Docs</a>
      </div>
      <div className="navbar-actions">
        {isApp ? (
          <ConnectButton />
        ) : (
          <Link to="/app" className="btn-launch">Launch App</Link>
        )}
      </div>
    </nav>
  )
}
