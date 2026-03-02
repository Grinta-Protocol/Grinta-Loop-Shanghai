export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-brand">Grinta Protocol</span>
        <div className="footer-links">
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a
            href={`https://sepolia.starkscan.co/contract/${encodeURIComponent('0x041649a23c3bc0d960b0de649fe96d1380199153c2b9fbb2c2b3b81792038c15')}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Contracts
          </a>
          <span className="footer-starknet">Built on Starknet</span>
        </div>
      </div>
    </footer>
  )
}
