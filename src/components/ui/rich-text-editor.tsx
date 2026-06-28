'use client'

// Tiptap-based note editor: bold / italic / underline / highlight, bullet
// + numbered lists, and checkboxes (task list). The editor stores content
// as HTML; the form's hidden <input name="content"> is kept in sync via
// onUpdate so the existing server actions (which expect a string) work
// without changes.
//
// Plain-text legacy content lives alongside HTML — Tiptap accepts a raw
// string as initial content and turns paragraphs into <p>s automatically.
// So an old plain-text note opens in the editor cleanly and saves back as
// HTML once the user edits anything.

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Link } from '@tiptap/extension-link'
import HardBreak from '@tiptap/extension-hard-break'
import type { JSONContent } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'

// Tiptap accepts a string for `content` but parses it as HTML — so a
// plain-text legacy note carrying real \n line breaks gets collapsed by
// HTML whitespace rules and lands in the editor as one giant wall of
// text. Detect plain text up front and wrap each paragraph in <p> tags
// (single \n → <br>) so the editor mirrors the read-only card layout
// instead of flattening it.
const HTML_TAG_RE = /<\/(p|div|ul|ol|li|h[1-6]|blockquote|pre|code|br|strong|em|u|mark|span|a|table|tr|td|th)\b[^>]*>/i
function looksLikeHtml(s: string): boolean {
  return HTML_TAG_RE.test(s) || /<br\s*\/?\s*>/i.test(s)
}
function plainTextToHtml(text: string): string {
  if (!text || !text.trim()) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Paragraph breaks (2+ newlines) become separate <p>s; in-paragraph
  // newlines become <br> so visual structure round-trips through Tiptap.
  return escaped
    .split(/\n{2,}/)
    .map((p) => {
      const inner = p.replace(/\n/g, '<br>').trim()
      return inner ? `<p>${inner}</p>` : ''
    })
    .filter(Boolean)
    .join('')
}
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Highlighter,
  List,
  ListOrdered,
  ListChecks,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  /** Hidden form field name. The editor mirrors its HTML into a hidden
   *  input so server-action callers keep working unchanged. */
  name: string
  /** Initial value (plain text or HTML). */
  defaultValue?: string
  placeholder?: string
  /** Fires whenever the content changes — useful for unsaved-guard hooks. */
  onChange?: () => void
}

export function RichTextEditor({ name, defaultValue = '', placeholder, onChange }: Props) {
  const [html, setHtml] = useState(defaultValue)
  // Drives the toolbar's "delete checked" button enabled state. Updated
  // from onUpdate so the button greys out when there's nothing checked.
  const [hasChecked, setHasChecked] = useState(false)
  // Keep the latest onChange callback in a ref so we can call it from inside
  // the editor's onUpdate without recreating the editor on every render.
  // Updated inside an effect so we don't write to a ref during render
  // (react-hooks/no-ref-during-render).
  const onChangeRef = useRef<typeof onChange>(undefined)
  const sortingTasksRef = useRef(false)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Drop the bundled Link extension so we can configure our own with
        // openOnClick + autolink behaviour.
        link: false,
        // Don't bundle Underline — we use the standalone extension below.
        // (StarterKit doesn't actually include Underline in 3.x but listing it
        //  here makes the intent obvious and survives future bundling changes.)
        // Drop the bundled HardBreak so the standalone extension below can
        // own the Enter / Shift-Enter keymap without conflict.
        hardBreak: false,
      }),
      // Enter / Shift+Enter swap: Lance flagged that the default Tiptap
      // behavior (Enter → new <p>) was leaving "huge CR" gaps between
      // every line of an imported note. He'd been working around it by
      // hitting Ctrl+Enter for a soft break. We invert the defaults so
      // Enter = soft break (<br>, tight) and Shift+Enter = new paragraph
      // (still available when he genuinely wants section spacing).
      HardBreak.extend({
        addKeyboardShortcuts() {
          return {
            Enter: () => this.editor.commands.setHardBreak(),
            'Shift-Enter': () => this.editor.commands.splitBlock(),
            // Keep Ctrl/Cmd+Enter as an alias for soft break so Lance's
            // existing muscle memory still works.
            'Mod-Enter': () => this.editor.commands.setHardBreak(),
          }
        },
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: 'text-emerald-400 underline decoration-emerald-700 hover:decoration-emerald-500',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    // Render the editor on the client only — Next.js dev complains otherwise
    // because Tiptap touches DOM during initial setup.
    immediatelyRender: false,
    // Wrap plain-text legacy content in <p>/<br> so Tiptap doesn't
    // collapse the \n line breaks (the editor used to render a wall of
    // text for every imported IDNW note). HTML content passes straight
    // through.
    content: looksLikeHtml(defaultValue) ? defaultValue : plainTextToHtml(defaultValue),
    onUpdate: ({ editor }) => {
      if (!sortingTasksRef.current) {
        const sorted = moveCheckedTasksToBottom(editor.getJSON())
        if (sorted.changed) {
          sortingTasksRef.current = true
          editor.commands.setContent(sorted.doc, { emitUpdate: false })
          sortingTasksRef.current = false
        }
      }
      setHasChecked(hasCheckedTasks(editor.getJSON()))
      const next = editor.getHTML()
      setHtml(next)
      if (onChangeRef.current) onChangeRef.current()
    },
    editorProps: {
      attributes: {
        class:
          'note-rich min-h-[12rem] px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition',
      },
    },
  })

  // Keep the hidden input in sync if the editor's html state somehow
  // diverges (paste from outside, etc.).
  useEffect(() => {
    if (!editor) return
    // no-op — onUpdate covers the streaming case; this effect just keeps
    // the dep linter happy when we eventually wire external resets.
  }, [editor, html])

  if (!editor) {
    return (
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={8}
        className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
      />
    )
  }

  // Local alias preserves the non-null narrowing through the closure;
  // referencing `editor` directly here re-widens to nullable inside the
  // function body and trips tsc.
  const liveEditor = editor
  function deleteCheckedTasks() {
    const stripped = removeCheckedTasks(liveEditor.getJSON())
    if (!stripped.changed) return
    liveEditor.commands.setContent(stripped.doc, { emitUpdate: true })
  }

  return (
    <div className="space-y-2">
      <Toolbar editor={editor} hasChecked={hasChecked} onDeleteChecked={deleteCheckedTasks} />
      <EditorContent editor={editor} />
      {placeholder && editor.isEmpty && (
        <p className="text-xs text-stone-500 -mt-1">{placeholder}</p>
      )}
      {/* Hidden input mirrors the HTML so the form submission (existing
          server actions read formData.get('content') as string) works
          without any changes. */}
      <input type="hidden" name={name} value={html} />
    </div>
  )
}

// Walks the Tiptap doc looking for any taskItem with attrs.checked true.
// Used to drive the toolbar's "delete checked" button enabled state so the
// button greys out cleanly when there's nothing to delete.
function hasCheckedTasks(doc: JSONContent): boolean {
  if (doc.type === 'taskItem' && doc.attrs?.checked) return true
  if (Array.isArray(doc.content)) {
    for (const child of doc.content) {
      if (hasCheckedTasks(child)) return true
    }
  }
  return false
}

// Strip every taskItem whose checked flag is true from every taskList in
// the doc. Empty taskLists (all items removed) are dropped too so we don't
// leave a hollow checklist node behind.
function removeCheckedTasks(doc: JSONContent): { doc: JSONContent; changed: boolean } {
  function visit(node: JSONContent): { node: JSONContent | null; changed: boolean } {
    let changed = false
    const childResults = node.content?.map((child) => {
      const r = visit(child)
      if (r.changed) changed = true
      return r
    })
    const nextContent = childResults?.map((r) => r.node).filter((n): n is JSONContent => n !== null)

    if (node.type === 'taskList' && nextContent) {
      const kept = nextContent.filter((c) => !(c.type === 'taskItem' && c.attrs?.checked))
      if (kept.length !== nextContent.length) changed = true
      if (kept.length === 0) return { node: null, changed: true }
      return { node: { ...node, content: kept }, changed }
    }

    return {
      node: nextContent ? { ...node, content: nextContent } : node,
      changed,
    }
  }

  const result = visit(doc)
  return { doc: result.node ?? doc, changed: result.changed }
}

function moveCheckedTasksToBottom(doc: JSONContent): { doc: JSONContent; changed: boolean } {
  function visit(node: JSONContent): { node: JSONContent; changed: boolean } {
    let changed = false
    const content = node.content?.map((child) => {
      const result = visit(child)
      if (result.changed) changed = true
      return result.node
    })

    if (node.type !== 'taskList' || !content) {
      return {
        node: content ? { ...node, content } : node,
        changed,
      }
    }

    const unchecked = content.filter((child) => !child.attrs?.checked)
    const checked = content.filter((child) => !!child.attrs?.checked)
    const reordered = [...unchecked, ...checked]
    const taskOrderChanged = reordered.some((child, index) => child !== content[index])

    return {
      node: { ...node, content: reordered },
      changed: changed || taskOrderChanged,
    }
  }

  const result = visit(doc)
  return { doc: result.node, changed: result.changed }
}

// Toolbar stays on ONE line on every viewport. Buttons are 28px on
// mobile / 32px on md+, gap is tight, and any narrow phone where the
// row still overflows gets a horizontal scroll instead of wrapping
// (which used to push the last few buttons onto a second row,
// breaking the "tap < or > to undo" affordance Lance flagged).
// Scrollbar hidden visually — feel is touch-scroll.
function Toolbar({
  editor,
  hasChecked,
  onDeleteChecked,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>
  hasChecked: boolean
  onDeleteChecked: () => void
}) {
  return (
    <div className="flex flex-nowrap items-center gap-0.5 sm:gap-1 rounded-lg border border-stone-700 bg-stone-900/60 px-1.5 py-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
      >
        <UnderlineIcon size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('highlight')}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        title="Highlight"
      >
        <Highlighter size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="Checklist"
      >
        <ListChecks size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={onDeleteChecked}
        disabled={!hasChecked}
        title="Delete all checked items"
      >
        <Trash2 size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (Ctrl+Z)"
        disabled={!editor.can().undo()}
      >
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (Ctrl+Shift+Z)"
        disabled={!editor.can().redo()}
      >
        <Redo2 size={14} />
      </ToolbarButton>
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-stone-700/80" aria-hidden />
}

function ToolbarButton({
  children,
  onClick,
  active,
  title,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  title: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded transition disabled:opacity-40 disabled:cursor-not-allowed',
        active
          ? 'bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-700/60'
          : 'text-stone-300 hover:bg-stone-800 hover:text-stone-100',
      )}
    >
      {children}
    </button>
  )
}
