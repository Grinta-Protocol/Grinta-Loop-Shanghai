import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar.jsx'
import Footer from '../components/Footer.jsx'
import './Landing.css'

export default function Landing() {
  return (
    <div className="landing">
      <Navbar />

      {/* Hero */}
      <section className="hero">
        <h1 className="hero-title">
          The Agent-Native<br />Stablecoin
        </h1>
        <p className="hero-sub">
          GRIT is a PID-controlled stablecoin on Starknet. No keepers, no governance votes
          to change rates — every Ekubo swap automatically updates the redemption price.
        </p>
        <div className="hero-ctas">
          <Link to="/app" className="btn-primary">Launch App</Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Stats row */}
      <section className="info-cards">
        <div className="info-card">
          <div className="info-card-label">Collateral</div>
          <div className="info-card-value">WBTC</div>
          <div className="info-card-desc">Wrapped Bitcoin on Starknet</div>
        </div>
        <div className="info-card">
          <div className="info-card-label">Stablecoin</div>
          <div className="info-card-value">GRIT</div>
          <div className="info-card-desc">Reflexive, non-pegged to $1</div>
        </div>
        <div className="info-card">
          <div className="info-card-label">Stability</div>
          <div className="info-card-value">PID Controller</div>
          <div className="info-card-desc">Algorithmic rate adjustment</div>
        </div>
      </section>

      {/* Agent Skills section */}
      <section className="skills-section">
        <h2 className="section-title">Built for Agents</h2>
        <p className="section-sub">
          Grinta ships with everything AI agents need to interact with the protocol autonomously.
        </p>
        <div className="skills-grid">
          <div className="skill-card">
            <div className="skill-icon">SKILL.md</div>
            <h3>Agent Knowledge</h3>
            <p>
              A structured knowledge file that any LLM can read to understand the protocol:
              contract addresses, function signatures, parameter formats, and safe interaction patterns.
            </p>
          </div>
          <div className="skill-card">
            <div className="skill-icon">MCP Server</div>
            <h3>Agent Execution</h3>
            <p>
              16 tools for reading protocol state and executing transactions.
              Agents connect via Model Context Protocol to open SAFEs, manage positions,
              and monitor system health — no custom code needed.
            </p>
          </div>
        </div>
      </section>

      {/* How agents use it */}
      <section className="steps-section">
        <h2 className="section-title">How Agents Use Grinta</h2>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <h3>Connect MCP</h3>
            <p>Agent loads the MCP server and discovers 16 available tools</p>
          </div>
          <div className="step-arrow">&rarr;</div>
          <div className="step">
            <div className="step-num">2</div>
            <h3>Read Rates</h3>
            <p>Query redemption price, collateral price, and position health</p>
          </div>
          <div className="step-arrow">&rarr;</div>
          <div className="step">
            <div className="step-num">3</div>
            <h3>Execute Strategy</h3>
            <p>Open SAFEs, adjust positions, and manage risk autonomously</p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
