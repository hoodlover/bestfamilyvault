'use client'

// Read-only Tiptap renderer for note content authored in RichTextEditor —
// renders B/U/highlight/lists/checkboxes from HTML.
//
// Plain-text legacy notes (anything that doesn't look like HTML) take a
// separate render path: a whitespace-pre-wrap div with LinkifiedText,
// because Tiptap collapses \n characters in plain-text input into single
// spaces, which mashed multi-line notes (e.g. the Vault Recovery Guide)
// into one long unreadable run-on. Detect by looking for any HTML-ish
// closing tag — if there isn't one, treat as plain text.

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Link } from '@tiptap/extension-link'
import { LinkifiedText } from './linkified-text'

interface Props {
  content: string
  className?: string
}

const HTML_TAG_RE = /<\/(p|div|ul|ol|li|h[1-6]|blockquote|pre|code|br|strong|em|u|mark|span|a|table|tr|td|th)\b[^>]*>/i

function looksLikeHtml(s: string) {
  return HTML_TAG_RE.test(s) || /<br\s*\/?\s*>/i.test(s)
}

export function RichTextDisplay({ content, className }: Props) {
  const isHtml = looksLikeHtml(content)

  // Hooks must run unconditionally — keep useEditor at the top regardless
  // of which branch we render. The editor instance is just unused for
  // plain-text content.
  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    content: isHtml ? content : '',
    extensions: [
      StarterKit.configure({ link: false }),
      Underline,
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: true,
        autolink: true,
        HTMLAttributes: {
          class: 'text-emerald-400 underline decoration-emerald-700 hover:decoration-emerald-500 break-all',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: (className ?? '') + ' note-rich focus:outline-none',
      },
    },
  })

  if (!isHtml) {
    // Plain-text path — preserve newlines and linkify URLs.
    return (
      <div className={(className ?? '') + ' note-rich whitespace-pre-wrap break-words'}>
        <LinkifiedText text={content} />
      </div>
    )
  }

  if (!editor) return null
  return <EditorContent editor={editor} />
}
