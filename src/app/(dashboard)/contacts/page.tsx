import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { listMyContacts, getMyGmailLink } from '@/lib/actions/gmail-contacts'
import { ContactsList } from '@/components/ui/contacts-list'

export default async function ContactsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const [contacts, link] = await Promise.all([
    listMyContacts(),
    getMyGmailLink(),
  ])

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-32">
      <ContactsList
        initialContacts={contacts}
        link={link}
      />
    </div>
  )
}
