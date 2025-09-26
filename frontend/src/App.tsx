import './App.css'
import SignInWithEthereum from './SignInWithEthereum'

function App() {
  return (
    <div>
      <header style={{ padding: 16, borderBottom: '1px solid #eee' }}>
        <h1>SIWE Auth Demo</h1>
      </header>
      <main>
        <SignInWithEthereum />
      </main>
    </div>
  )
}

export default App
