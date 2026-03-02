import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '2rem',
          background: '#1a1a2e',
          border: '1px solid #ff4444',
          borderRadius: '12px',
          margin: '1rem',
          color: '#e0e0e0',
        }}>
          <h3 style={{ color: '#ff4444', marginBottom: '0.5rem' }}>Something went wrong</h3>
          <pre style={{ fontSize: '0.8rem', color: '#888', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#00d4aa', color: '#0a0a0a', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
