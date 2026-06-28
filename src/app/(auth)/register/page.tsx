import { Suspense } from 'react'
import { RegisterForm } from './register-form'

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-8 shadow-2xl text-center">
        <div className="text-stone-500 text-sm">Loading...</div>
      </div>
    }>
      <RegisterForm />
    </Suspense>
  )
}
