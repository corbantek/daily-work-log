import { visit, SKIP } from 'unist-util-visit'
import type { Root, Text, Element } from 'hast'

// Keywords highlighted in rendered markdown. TODO matches anywhere (so "TODOs" still lights up);
// DONE must be a whole word, otherwise it would also fire inside ABANDONED / UNDONE.
const KEYWORDS = /(TODO|\bDONE\b)/
const CLASS_NAMES: Record<string, string> = { TODO: 'todo-keyword', DONE: 'done-keyword' }

export function rehypeHighlightTodo() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null || !KEYWORDS.test(node.value)) return

      // With a capturing group, split() keeps the matched keywords at the odd positions.
      const children: (Text | Element)[] = []
      node.value.split(KEYWORDS).forEach((part, i) => {
        if (!part) return
        if (i % 2 === 1) {
          children.push({
            type: 'element',
            tagName: 'span',
            properties: { className: [CLASS_NAMES[part]] },
            children: [{ type: 'text', value: part }],
          })
        } else {
          children.push({ type: 'text', value: part })
        }
      })

      parent.children.splice(index, 1, ...children)
      // Continue after the nodes just inserted, so the new spans aren't visited (and wrapped) again.
      return [SKIP, index + children.length]
    })
  }
}
