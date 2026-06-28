import { Suspense } from 'react'
import { ResetPasswordForm } from '@/components/ui/reset-password-form'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm token={token ?? ''} />
    </Suspense>
  )
}
