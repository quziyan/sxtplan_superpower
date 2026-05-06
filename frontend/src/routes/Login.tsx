import { useState, type CSSProperties, type FormEvent } from 'react'
import { Btn } from '@/components/Btn'
import { Card } from '@/components/Card'
import { login } from '@/lib/auth'

const inputStyle: CSSProperties = {
  background: 'var(--c-bg-1)', color: 'var(--c-text)',
  border: '1px solid var(--c-line)', borderRadius: 'var(--rad-2)',
  padding: '8px 10px', fontSize: 13, outline: 'none',
}

const labelStyle: CSSProperties = {
  fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: 0.5,
}

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setLoading(true)
    try { await login(email, password); onLoggedIn() }
    catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c-bg)' }}>
      <div style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--sp-5)' }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>CNP · 新闻驱动决策预测</div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-3)', marginTop: 4 }}>登录后选择你的角色态</div>
        </div>
        <Card>
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <label style={labelStyle}>邮箱</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="email" autoFocus />
            <label style={{ ...labelStyle, marginTop: 4 }}>密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
            {err && <div style={{ color: 'var(--c-bad)', fontSize: 12 }}>{err}</div>}
            <Btn variant="primary" disabled={loading} style={{ marginTop: 'var(--sp-2)', justifyContent: 'center' }}>
              {loading ? '登录中…' : '登录'}
            </Btn>
          </form>
        </Card>
      </div>
    </div>
  )
}
