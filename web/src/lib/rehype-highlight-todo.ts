import { visit } from 'unist-util-visit'
import type { Root, Text, Element } from 'hast'

export function rehypeHighlightTodo() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!node.value.includes('TODO') || !parent || index == null) return

      const parts = node.value.split('TODO')
      const children: (Text | Element)[] = []
      parts.forEach((part, i) => {
        if (part) children.push({ type: 'text', value: part })
        if (i < parts.length - 1) {
          children.push({
            type: 'element',
            tagName: 'span',
            properties: { className: ['todo-keyword'] },
            children: [{ type: 'text', value: 'TODO' }],
          })
        }
      })

      parent.children.splice(index, 1, ...children)
    })
  }
}
